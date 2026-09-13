import { NextResponse, after } from "next/server";

import { lerAviso, RE_TOKEN, tokenConfere } from "@/lib/asaas/webhook";
import { processarEvento } from "@/lib/asaas/webhook-asaas";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";

/**
 * POST /api/cb/asaas/webhook/[token]  — PÚBLICO, autenticado pelo cabeçalho.
 *
 * O Asaas bate aqui a cada mudança de estado de uma cobrança (e nos eventos
 * de chave). Ordem, e o motivo de cada passo:
 *   1. o token da URL diz de QUAL conta é a entrega (404 se não há);
 *   2. `asaas-access-token` é comparado em tempo constante com o token que
 *      o CRM informou ao criar o webhook (401 se não bate — nada é gravado);
 *   3. o corpo é AVISO (D8): só `payment.id` ou `accessToken.name` são lidos;
 *   4. o evento é gravado com `ON CONFLICT DO NOTHING` em
 *      (conta, id do evento): o Asaas entrega "pelo menos uma vez" e repete o
 *      mesmo id no reenvio — a cópia não é processada;
 *   5. responde 200 e trabalha em `after()`: o Asaas espera 10 s, e o
 *      trabalho é reler a cobrança na API e aplicar ao espelho.
 *
 * ⚠️ Limite por token estourado responde **200 `{ adiado: true }`**, sem
 * gravar nem processar: só 200 conta como entrega — um 429 contaria como
 * falha e ajudaria a interromper a fila (15 falhas seguidas), e o ciclo de
 * 15 min reconcilia o que ficou de fora. 404 e 401 são as únicas respostas
 * que não são 200, e só acontecem com URL ou token errados.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!RE_TOKEN.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const limit = checkRateLimit(`asaas:webhook:${token}`, RATE_LIMITS.asaasWebhook);
  if (!limit.success) return NextResponse.json({ ok: true, adiado: true });

  const admin = supabaseAdmin();
  const { data: config, error } = await admin
    .from("cb_asaas_config")
    .select("account_id, webhook_auth_token")
    .eq("webhook_token", token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
  if (!config || typeof config.webhook_auth_token !== "string") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const accountId = config.account_id as string;

  let esperado: string;
  try {
    esperado = decrypt(config.webhook_auth_token);
  } catch {
    console.error("[asaas] token do webhook ilegível para a conta", accountId);
    return NextResponse.json({ error: "auth_token_unreadable" }, { status: 500 });
  }
  if (!tokenConfere(request.headers.get("asaas-access-token"), esperado)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const corpo: unknown = await request.json().catch(() => null);
  const aviso = lerAviso(corpo);
  if (!aviso) {
    console.info(`[asaas] entrega sem id/event na conta ${accountId} — ignorada`);
    return NextResponse.json({ ok: true, ignorado: true });
  }

  const { data: gravado, error: erroInsert } = await admin
    .from("cb_asaas_eventos")
    .upsert(
      {
        account_id: accountId,
        asaas_event_id: aviso.eventoId,
        evento: aviso.evento,
        asaas_payment_id: aviso.tipo === "cobranca" ? aviso.paymentId : null,
        evento_criado_em: aviso.criadoEm,
      },
      { onConflict: "account_id,asaas_event_id", ignoreDuplicates: true },
    )
    .select("id");
  if (erroInsert) {
    console.error("[asaas] não foi possível gravar o evento:", erroInsert.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  const eventoId = gravado?.[0]?.id as string | undefined;
  if (!eventoId) return NextResponse.json({ ok: true, duplicado: true });

  // Entrega chegando é prova de vida da fila: corrige um `interrompido` ou
  // `penalizado` que o cron gravou numa hora ruim. `desligado` fica —
  // depois do DELETE ainda chega a retentativa de uma entrega antiga.
  const agora = new Date().toISOString();
  await admin
    .from("cb_asaas_config")
    .update({ last_event_at: agora, webhook_state: "ativo", updated_at: agora })
    .eq("account_id", accountId)
    .in("webhook_state", ["ativo", "penalizado", "interrompido"]);

  after(async () => {
    await processarEvento(supabaseAdmin(), accountId, aviso, { eventoId });
  });

  return NextResponse.json({ ok: true });
}
