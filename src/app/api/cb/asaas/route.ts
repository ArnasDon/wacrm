import { NextResponse } from "next/server";

import { cartaoDoAsaas, type ConfigDoAsaas } from "@/lib/asaas/cartao";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/cb/asaas  (admin+)
 *
 * O cartão "Asaas" da aba Integrações: se está conectado, com que nome de
 * chave, desde quando, e o último erro.
 *
 * ⚠️ A chave NÃO sai daqui, nem mascarada — a linha é lida com service role
 * e as colunas devolvidas são nomeadas uma a uma, nunca `select('*')`.
 */
export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data, error } = await supabaseAdmin()
      .from("cb_asaas_config")
      .select("chave_nome, ambiente, chave_expira_em, status, last_sync_at, last_error, created_at")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Não foi possível ler a integração." }, { status: 500 });

    return NextResponse.json({ cartao: cartaoDoAsaas((data ?? null) as ConfigDoAsaas | null) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
