import { NextResponse, after } from "next/server";

import { conectarAsaas, desconectarAsaas } from "@/lib/asaas/conexao";
import { sincronizarAsaas } from "@/lib/asaas/sincronizar";
import { origemPublica, podeCriarDaqui } from "@/lib/asaas/webhook";
import { cuidarDoWebhook } from "@/lib/asaas/webhook-asaas";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * PUT /api/cb/asaas/config  (admin+) — conecta (ou troca a chave).
 *
 * Corpo: `{ api_key, chave_nome?, chave_expira_em? }`. A chave é TESTADA na
 * hora (uma listagem de UM cliente) e gravada cifrada. Falha volta como
 * CÓDIGO, nunca a mensagem crua do Asaas — a mensagem do provedor é o lugar
 * clássico por onde a chave enviada vaza para o log.
 *
 * Depois de conectar, a primeira sincronização roda em `after()` (é o
 * mesmo código do cron): a listagem completa de clientes, as vencidas, o
 * vínculo e as fichas da D2.
 *
 * DELETE — desconecta: apaga a config. A chave some do banco; refazer a
 * conexão exige colá-la de novo. Com `?espelho=1`, apaga também os dados
 * guardados do Asaas (clientes e cobranças) — nunca as fichas do CRM.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as
      | { api_key?: unknown; chave_nome?: unknown; chave_expira_em?: unknown }
      | null;
    const chave = typeof corpo?.api_key === "string" ? corpo.api_key.trim() : "";
    if (chave.length < 10 || chave.length > 500) return NextResponse.json({ error: "chave_invalida" }, { status: 400 });

    const nome = typeof corpo?.chave_nome === "string" ? corpo.chave_nome.trim().slice(0, 120) : null;
    const expira = typeof corpo?.chave_expira_em === "string" && /^\d{4}-\d{2}-\d{2}$/.test(corpo.chave_expira_em) ? corpo.chave_expira_em : null;

    const admin = supabaseAdmin();
    const r = await conectarAsaas(admin, ctx.accountId, ctx.userId, chave, { nome, expiraEm: expira });
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : 400;
      return NextResponse.json({ error: r.codigo }, { status });
    }
    // ⚠️ O webhook só é criado quando o pedido vem do PRÓPRIO host público:
    // o preview carrega a URL da produção e registraria um endereço que só
    // atende depois do deploy. Fora daqui, o cron da VPS cria no ciclo seguinte.
    const origem = origemPublica();
    const criarWebhook = podeCriarDaqui(origem, request);
    after(async () => {
      await sincronizarAsaas(admin, ctx.accountId, { completa: true });
      if (criarWebhook) await cuidarDoWebhook(admin, ctx.accountId, { origem });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    // `?espelho=1` apaga também os clientes e as cobranças guardados — é o
    // caminho para trocar de CONTA do Asaas. As fichas criadas pela D2 ficam.
    const apagarEspelho = new URL(request.url).searchParams.get("espelho") === "1";
    const r = await desconectarAsaas(supabaseAdmin(), ctx.accountId, { apagarEspelho });
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.codigo === "em_curso" ? 409 : 500 });
    // `webhookNaoApagado`: o Asaas não aceitou o DELETE (chave já inválida,
    // rede) — o cartão manda apagar no painel, senão o Asaas insiste por
    // horas numa URL que não responde mais e interrompe a fila com três e-mails.
    return NextResponse.json({ ok: true, webhookNaoApagado: r.webhookNaoApagado === true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
