// ============================================================
// O botão "Enviar teste" de Configurações → Webhooks → Enviados.
//
// Manda UM envelope de exemplo (`exemplos.ts`, com `test: true`) ao endereço
// cadastrado e devolve o que aconteceu, para o operador conferir o formato no
// n8n ANTES de esperar um card se mexer de verdade.
//
// ⚠️ Mesmo pedido da entrega real, peça por peça — é o ponto do teste:
//   - o pedido sai de `pedidoDeEntrega` (os mesmos cabeçalhos, a assinatura
//     sobre os bytes exatos, `redirect: 'manual'`, o mesmo prazo);
//   - o mesmo guarda de SSRF (`isDeliverableUrl`);
//   - o mesmo segredo decifrado.
// Um teste que passasse por outro caminho aprovaria um endpoint que a entrega
// real recusa.
//
// ⚠️ NÃO toca em `failure_count` nem em `last_delivery_at`. O teste é gesto
// manual: quinze cliques contra um endereço errado DESLIGARIAM o endpoint
// (`MAX_CONSECUTIVE_FAILURES`), e um teste bem-sucedido carimbaria "última
// entrega" sobre um aviso que não foi evento nenhum.
//
// Funciona com o endpoint desligado e para evento que ele NÃO assina: é teste
// de FORMATO — o operador quer ver o `deal.stage_changed` antes de assiná-lo.
// ============================================================

import { randomUUID } from 'node:crypto';

import { decrypt } from '@/lib/whatsapp/encryption';
import { pedidoDeEntrega } from '@/lib/webhooks/deliver';
import { exemploDeEnvelope } from '@/lib/webhooks/exemplos';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { WebhookEvent } from '@/lib/webhooks/events';

/**
 * Por que o teste não passou. Chaves estáveis: a tela as traduz.
 *
 * - `http`: o endereço respondeu, mas fora de 2xx (`status` diz qual);
 * - `redirecionamento`: respondeu 3xx — a entrega não segue redirecionamento
 *   (um endereço público poderia apontar para a rede interna);
 * - `tempo`: não respondeu em `DELIVERY_TIMEOUT_MS` (5 s, `deliver.ts`);
 * - `rede`: resolveu o nome, mas não deu para conectar (recusa, TLS, queda);
 * - `endereco_bloqueado`: o guarda de SSRF recusou o endereço — ele resolve
 *   para rede privada ou interna, OU o nome NÃO RESOLVE (domínio digitado
 *   errado). `isDeliverableUrl` não separa os dois, então a tela precisa
 *   dizer as duas possibilidades;
 * - `segredo_ilegivel`: o segredo gravado não decifra (a `ENCRYPTION_KEY`
 *   mudou) — nenhuma entrega real sairia assinada; recriar o endpoint resolve.
 */
export type MotivoDaFalhaDoTeste =
  | 'http'
  | 'redirecionamento'
  | 'tempo'
  | 'rede'
  | 'endereco_bloqueado'
  | 'segredo_ilegivel';

/**
 * A resposta de `POST /api/cb/webhooks-de-saida/{id}/teste` quando o endpoint
 * existe — sempre 200: o teste RODOU, e o resultado dele é dado, não erro.
 * `ms` é quanto o teste levou, do começo ao fim.
 */
export type ResultadoDoTeste =
  | { ok: true; status: number; ms: number }
  | { ok: false; status: number | null; motivo: MotivoDaFalhaDoTeste; ms: number };

export interface EndpointDoTeste {
  id: string;
  url: string;
  /** O segredo CIFRADO, como está em `webhook_endpoints.secret`. */
  secret: string;
}

/** Nunca lança: toda saída é um `ResultadoDoTeste`. */
export async function enviarTeste(
  endpoint: EndpointDoTeste,
  evento: WebhookEvent,
  accountId: string
): Promise<ResultadoDoTeste> {
  const inicio = Date.now();
  const ms = () => Date.now() - inicio;

  if (!(await isDeliverableUrl(endpoint.url))) {
    return { ok: false, status: null, motivo: 'endereco_bloqueado', ms: ms() };
  }

  let segredo: string;
  try {
    segredo = decrypt(endpoint.secret);
  } catch {
    return { ok: false, status: null, motivo: 'segredo_ilegivel', ms: ms() };
  }

  const corpo = JSON.stringify(
    exemploDeEnvelope(evento, {
      accountId,
      // Id NOVO a cada clique: quem deduplica pelo id não pode engolir o
      // segundo teste.
      id: randomUUID(),
      quando: new Date().toISOString(),
      teste: true,
    })
  );

  let resposta: Response;
  try {
    resposta = await fetch(
      endpoint.url,
      pedidoDeEntrega({
        endpointId: endpoint.id,
        evento,
        corpo,
        segredo,
        tsSegundos: Math.floor(Date.now() / 1000),
      })
    );
  } catch (err) {
    // `AbortSignal.timeout` rejeita com um `DOMException` de nome
    // `TimeoutError`; `AbortError` cobre o runtime que ainda não distingue os
    // dois. Lido pelo nome, sem `instanceof`: DOMException não é Error em todo
    // runtime.
    const nome = (err as { name?: unknown } | null)?.name;
    const motivo = nome === 'TimeoutError' || nome === 'AbortError' ? 'tempo' : 'rede';
    return { ok: false, status: null, motivo, ms: ms() };
  }

  // Descarta o corpo da resposta: o que interessa é o status, e um corpo
  // pendurado segura a conexão (e, com endpoint lento, o prazo) à toa.
  await resposta.body?.cancel().catch(() => {});

  // Com `redirect: 'manual'` o Node devolve o 3xx como está; o navegador
  // devolveria `opaqueredirect` com status 0 — os dois contam.
  if (resposta.type === 'opaqueredirect' || (resposta.status >= 300 && resposta.status < 400)) {
    return { ok: false, status: resposta.status || null, motivo: 'redirecionamento', ms: ms() };
  }
  if (!resposta.ok) {
    return { ok: false, status: resposta.status, motivo: 'http', ms: ms() };
  }
  return { ok: true, status: resposta.status, ms: ms() };
}
