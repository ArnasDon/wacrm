import { NextResponse } from "next/server";

import { AsaasError } from "@/lib/asaas/cliente";
import { clienteDaConta } from "@/lib/asaas/conexao";
import { levantar } from "@/lib/asaas/levantamento";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/asaas/levantamento  (admin+)
 *
 * O levantamento da Fase 0 (§3.1 do plano), com a chave que já está
 * guardada: quantos clientes e cobranças vencidas existem, em que formato o
 * Asaas devolve telefone e documento, quantos clientes o CRM conseguiria
 * ligar sozinho a uma ficha — e por qual régua —, e as sondas das perguntas
 * que a doc não responde (§2.3).
 *
 * ⚠️ **Só GET no Asaas e NADA gravado**, nem lá nem aqui: o relatório volta
 * na resposta e some. São estes números que decidem a forma das tabelas do
 * espelho, e por isso elas ainda não existem.
 *
 * ⚠️ **POST, e não GET**, porque custa uma varredura da conta inteira do
 * Asaas — e a cota de 25.000/12 h é da CONTA, dividida com qualquer outro
 * sistema do escritório que use a API.
 */
export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:levantamento:${ctx.userId}`, RATE_LIMITS.asaasLevantamento);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const conexao = await clienteDaConta(admin, ctx.accountId);
    if (!conexao.ok) {
      return NextResponse.json({ error: conexao.codigo }, { status: conexao.codigo === "db_error" ? 500 : 400 });
    }

    const relatorio = await levantar(admin, ctx.accountId, conexao.cliente);
    return NextResponse.json({ relatorio });
  } catch (err) {
    // O código do Asaas explica o que houve (permissão que falta, cota
    // estourada, lista de IPs ligada); a mensagem CRUA fica no log.
    if (err instanceof AsaasError) {
      console.error(`[asaas] levantamento falhou: ${err.codigo} — ${err.message}`);
      return NextResponse.json({ error: err.codigo }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
