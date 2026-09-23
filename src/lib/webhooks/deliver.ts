// ============================================================
// Outbound webhook delivery.
//
// `dispatchWebhookEvent` finds the account's active endpoints
// subscribed to an event, signs one JSON payload, and POSTs it to
// each in parallel. It is best-effort and never throws — callers fire
// it from the inbound webhook's `after()` block, where a failed
// delivery must not affect the 200 OK returned to Meta.
//
// Delivery semantics (documented in docs/public-api.md):
//   - UMA tentativa por evento, com prazo curto, e NENHUMA retentativa.
//     Endpoint fora do ar na hora perde aquele aviso — não existe fila de
//     reenvio.
//   - Repetição só existe quando a ORIGEM repete o fato (ex.: a Meta
//     reenvia um recibo). Aí o aviso sai de novo, e com `id` NOVO — cada
//     chamada sorteia o seu —, então quem precisa deduplicar usa o que
//     identifica o fato dentro do `data` (o `whatsapp_message_id`, por
//     exemplo), nunca o `id` do envelope.
//   - ⚠️ EXCETO nos eventos de negócio (`deal.*`): lá o `id` do envelope é o
//     id da linha da fila do funil (`opcoes.id`), estável, e a fila é
//     reivindicada uma vez só (`drain-events.ts`) — o mesmo fato nunca sai
//     com dois ids.
//   - Each consecutive failure bumps `failure_count`; once it crosses
//     MAX_CONSECUTIVE_FAILURES the endpoint is auto-disabled
//     (`is_active = false`) so a dead sink stops being hit. A success
//     resets the counter and stamps `last_delivery_at`.
//   - Durable retry-with-backoff would need a queue/worker (a
//     follow-up); in-process retries inside `after()` would burn the
//     route's duration budget without a real durability guarantee.
//
// (Uma versão deste cabeçalho dizia "at-most-once" aqui e "at-least-once"
// mais abaixo, sobre o mesmo `id`. As duas metades estavam erradas em
// direções opostas; a verdade é a lista acima.)
// ============================================================

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { WebhookEnvelope, WebhookEventData } from '@/lib/webhooks/dados-dos-eventos';
import type { WebhookEvent } from '@/lib/webhooks/events';

/** Per-endpoint HTTP timeout. Kept short — this runs in `after()`. */
export const DELIVERY_TIMEOUT_MS = 5000;

/** Auto-disable an endpoint after this many consecutive failures. */
export const MAX_CONSECUTIVE_FAILURES = 15;

/**
 * Os três cabeçalhos de toda entrega. Exportados para quem precisa CITÁ-LOS
 * sem redigitar (os testes, a documentação da tela) — o nome é contrato com
 * quem recebe, e o prefixo `X-Wacrm-` é identificador de protocolo herdado do
 * upstream: trocá-lo quebraria todo receptor já configurado.
 */
export const CABECALHO_EVENTO = 'X-Wacrm-Event';
export const CABECALHO_ENDPOINT = 'X-Wacrm-Webhook-Id';
export const CABECALHO_ASSINATURA = 'X-Wacrm-Signature';

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
}

/**
 * O pedido HTTP de UMA entrega: corpo, cabeçalhos assinados sobre os bytes
 * exatos do corpo, sem seguir redirecionamento e com prazo.
 *
 * ⚠️ Um lugar só para as DUAS portas que postam num endpoint — a entrega de
 * verdade (abaixo) e o botão "Enviar teste" da tela (`enviar-teste.ts`).
 * Duas cópias divergiriam, e o sintoma seria o pior possível: o teste
 * passando sobre um formato (cabeçalho, assinatura, redirecionamento) que a
 * entrega real não usa.
 */
export function pedidoDeEntrega(args: {
  endpointId: string;
  evento: WebhookEvent;
  /** O corpo JÁ serializado — a assinatura é calculada sobre ESTES bytes. */
  corpo: string;
  segredo: string;
  tsSegundos: number;
}): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CABECALHO_EVENTO]: args.evento,
      [CABECALHO_ENDPOINT]: args.endpointId,
      [CABECALHO_ASSINATURA]: buildSignatureHeader(args.corpo, args.segredo, args.tsSegundos),
    },
    body: args.corpo,
    // Do NOT follow redirects — a public URL could 3xx-bounce to an
    // internal address, bypassing the SSRF check. A 3xx is a
    // misconfiguration; treat it as a failure.
    redirect: 'manual',
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  };
}

/**
 * Deliver `event` (+ `data`) to every active endpoint of `accountId`
 * subscribed to it. Never throws.
 *
 * O `data` é tipado pelo evento (`WebhookEventData`, o contrato em
 * `dados-dos-eventos.ts`): um ponto de disparo que mande outra forma não
 * compila.
 *
 * `opcoes` existe para os eventos de negócio (`entregar-eventos-de-funil.ts`):
 *   - `id`: o id do envelope. Lá é o id da linha da fila — o id do FATO, o
 *     mesmo `data.event_id` —, para quem recebe descartar repetição;
 *   - `occurredAt`: a hora do FATO (o relógio do banco quando o card mudou),
 *     não a hora do envio. A fila pode entregar minutos depois.
 * Sem `opcoes`, o comportamento de sempre: id sorteado, hora de agora.
 */
export async function dispatchWebhookEvent<E extends WebhookEvent>(
  db: SupabaseClient,
  accountId: string,
  event: E,
  data: WebhookEventData[E],
  opcoes: { id?: string; occurredAt?: string } = {}
): Promise<void> {
  try {
    const { data: rows, error } = await db
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .contains('events', [event]);

    if (error || !rows || rows.length === 0) return;

    // Sign the exact bytes we send so a receiver can recompute the
    // HMAC over the raw request body. `id` is what the receiver dedupes
    // on — ver as semânticas no cabeçalho do arquivo: sorteado por
    // chamada, menos nos eventos de negócio, em que é o id do fato.
    const envelope: WebhookEnvelope<E> = {
      id: opcoes.id ?? randomUUID(),
      event,
      occurred_at: opcoes.occurredAt ?? new Date().toISOString(),
      account_id: accountId,
      data,
    };
    const payload = JSON.stringify(envelope);
    const tsSeconds = Math.floor(Date.now() / 1000);

    await Promise.allSettled(
      (rows as EndpointRow[]).map((row) =>
        deliverOne(db, row, event, payload, tsSeconds)
      )
    );
  } catch (err) {
    // Never let a delivery problem bubble into the webhook response.
    console.error('[webhooks] dispatch failed:', err);
  }
}

async function deliverOne(
  db: SupabaseClient,
  row: EndpointRow,
  event: WebhookEvent,
  payload: string,
  tsSeconds: number
): Promise<void> {
  // SSRF guard: refuse to POST to a host that resolves to a private /
  // loopback / link-local address. Counts as a failure so a
  // misconfigured internal URL surfaces and eventually auto-disables.
  if (!(await isDeliverableUrl(row.url))) {
    console.warn('[webhooks] refusing non-public delivery target for', row.id);
    await recordFailure(db, row);
    return;
  }

  let secret: string;
  try {
    secret = decrypt(row.secret);
  } catch (err) {
    // A row whose secret can't be decrypted can never produce a valid
    // signature — count it as a failure so it eventually auto-disables.
    console.error('[webhooks] secret decrypt failed for', row.id, err);
    await recordFailure(db, row);
    return;
  }

  try {
    const res = await fetch(
      row.url,
      pedidoDeEntrega({
        endpointId: row.id,
        evento: event,
        corpo: payload,
        segredo: secret,
        tsSegundos: tsSeconds,
      })
    );
    if (!res.ok) throw new Error(`endpoint responded ${res.status}`);

    // Success: clear the failure streak.
    await db
      .from('webhook_endpoints')
      .update({ failure_count: 0, last_delivery_at: new Date().toISOString() })
      .eq('id', row.id);
  } catch (err) {
    console.warn(
      `[webhooks] delivery to ${row.id} failed:`,
      err instanceof Error ? err.message : err
    );
    await recordFailure(db, row);
  }
}

async function recordFailure(db: SupabaseClient, row: EndpointRow): Promise<void> {
  // Atomic increment (+ auto-disable at the threshold) via a SQL
  // function — a read-modify-write here would lose increments when two
  // deliveries to the same endpoint run concurrently (e.g.
  // conversation.created + message.received for one inbound message),
  // so a dead endpoint might never reach the disable threshold.
  //
  // ⚠️ Só o service_role executa a função desde a 1037: ela é SECURITY
  // DEFINER e ficou aberta a `anon` desde a 028 — qualquer pessoa com o id de
  // um endpoint (que viaja no cabeçalho `X-Wacrm-Webhook-Id` de TODA entrega)
  // conseguia desligá-lo chamando a RPC quinze vezes. Os chamadores deste
  // módulo já passam o cliente de service role.
  const { error } = await db.rpc('record_webhook_failure', {
    endpoint_id: row.id,
    max_failures: MAX_CONSECUTIVE_FAILURES,
  });
  if (error) {
    console.error('[webhooks] record_webhook_failure failed for', row.id, error);
  }
}
