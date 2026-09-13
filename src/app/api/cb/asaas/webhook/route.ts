import { NextResponse } from "next/server";

import { origemPublica, podeCriarDaqui } from "@/lib/asaas/webhook";
import { apagarWebhook, ativarWebhook, religarWebhook } from "@/lib/asaas/webhook-asaas";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/asaas/webhook  (admin+) — `{ acao: 'ativar' }` cria (ou refaz)
 * o webhook no Asaas; `{ acao: 'religar' }` religa a fila interrompida.
 * DELETE — apaga o webhook no Asaas e marca `desligado` (o cron não recria).
 *
 * ⚠️ `ativar` só a partir do próprio host público (`podeCriarDaqui`): o
 * preview desta instalação carrega a URL da produção, e criar dali
 * registraria no Asaas um endereço que só atende depois do deploy.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:webhook:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { acao?: unknown } | null;
    const acao = corpo?.acao === "religar" ? "religar" : "ativar";
    const admin = supabaseAdmin();
    const origem = origemPublica();
    const r =
      acao === "religar"
        ? await religarWebhook(admin, ctx.accountId)
        : await ativarWebhook(admin, ctx.accountId, { origem: podeCriarDaqui(origem, request.url) ? origem : null });
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.codigo === "db_error" ? 500 : 400 });
    return NextResponse.json({ ok: true, estado: r.estado });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:webhook:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await apagarWebhook(supabaseAdmin(), ctx.accountId);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.codigo === "db_error" ? 500 : 400 });
    return NextResponse.json({ ok: true, estado: r.estado });
  } catch (err) {
    return toErrorResponse(err);
  }
}
