import { NextResponse } from "next/server";

import { cartaoDoAsaas, type ConfigDoAsaas } from "@/lib/asaas/cartao";
import { contarEspelho } from "@/lib/asaas/conexao";
import { lerEspelho } from "@/lib/asaas/espelho";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/cb/asaas  (admin+)
 *
 * O cartão "Asaas" da aba Integrações: se está conectado, com que nome de
 * chave, desde quando, o último erro, quando foi a última sincronização — e
 * o RESUMO do espelho (quantos clientes, ligados, para confirmar, sem ficha,
 * inadimplentes), que as listas do cartão detalham por
 * `GET /api/cb/asaas/clientes`.
 *
 * ⚠️ A chave NÃO sai daqui, nem mascarada — a linha é lida com service role
 * e as colunas devolvidas são nomeadas uma a uma, nunca `select('*')`. O
 * CPF também não sai daqui (o resumo é só contagem).
 */
export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("cb_asaas_config")
      .select("chave_nome, ambiente, chave_expira_em, status, last_sync_at, last_sync_attempt_at, vencidas_listadas_em, last_full_sync_at, sincronizando_desde, last_error, created_at")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Não foi possível ler a integração." }, { status: 500 });

    const cartao = cartaoDoAsaas((data ?? null) as ConfigDoAsaas | null);
    // O espelho pode existir sem config (desconectou sem apagar os dados):
    // a contagem entra na pergunta do "apagar" e no aviso de reconexão.
    const espelho = await lerEspelho(admin, ctx.accountId);
    const guardado = await contarEspelho(admin, ctx.accountId);
    return NextResponse.json({
      cartao,
      resumo: espelho.listas.resumo,
      leituraFresca: espelho.leituraFresca,
      guardado: guardado ?? { clientes: 0, cobrancas: 0 },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
