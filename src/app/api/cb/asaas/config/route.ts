import { NextResponse } from "next/server";

import { conectarAsaas, desconectarAsaas } from "@/lib/asaas/conexao";
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
 * ⚠️ Nada é sincronizado depois de conectar, de propósito: o espelho das
 * cobranças ainda não existe. O passo seguinte é o LEVANTAMENTO
 * (`POST /api/cb/asaas/levantamento`), que só lê.
 *
 * DELETE — desconecta: apaga a config. A chave some do banco; refazer a
 * conexão exige colá-la de novo.
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

    const r = await conectarAsaas(supabaseAdmin(), ctx.accountId, ctx.userId, chave, { nome, expiraEm: expira });
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : 400;
      return NextResponse.json({ error: r.codigo }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await desconectarAsaas(supabaseAdmin(), ctx.accountId);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
