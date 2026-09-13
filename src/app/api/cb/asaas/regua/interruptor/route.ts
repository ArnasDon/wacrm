import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * PUT /api/cb/asaas/regua/interruptor  (admin+) — o interruptor "Cobrança
 * automática" (998, D20) e o intervalo mínimo entre cobranças (D11, 13/09).
 * Corpo: `{ regua_ativa?: boolean, regua_intervalo_dias?: number }`.
 *
 * ⚠️ LIGAR carimba `regua_ativada_em`: só a parcela vista vencida DEPOIS
 * disto entra na régua (D13) — ligar não é retroativo, e religar depois de
 * um tempo desligado também não (o que venceu no intervalo fica de fora).
 * Desligar não apaga o carimbo antigo: ele é reescrito no próximo ligar.
 *
 * ⚠️ ROWCOUNT conferido: em service role o `.eq('account_id')` é a única
 * cerca, e sem linha de config (Asaas desconectado) não há o que ligar.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:regua-interruptor:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { regua_ativa?: unknown; regua_intervalo_dias?: unknown } | null;
    const patch: Record<string, unknown> = {};
    if (typeof corpo?.regua_ativa === "boolean") {
      patch.regua_ativa = corpo.regua_ativa;
      if (corpo.regua_ativa) patch.regua_ativada_em = new Date().toISOString();
    }
    if (corpo?.regua_intervalo_dias !== undefined) {
      const dias = Number(corpo.regua_intervalo_dias);
      if (!Number.isInteger(dias) || dias < 0 || dias > 60) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      patch.regua_intervalo_dias = dias;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin().from("cb_asaas_config").update(patch).eq("account_id", ctx.accountId).select("regua_ativa, regua_ativada_em, regua_intervalo_dias");
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "nao_conectado" }, { status: 404 });
    return NextResponse.json({ ok: true, ...data[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
