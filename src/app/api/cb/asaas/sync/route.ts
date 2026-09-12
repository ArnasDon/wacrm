import { NextResponse, after } from "next/server";

import { sincronizarAsaas } from "@/lib/asaas/sincronizar";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/asaas/sync  (admin+) — "Sincronizar agora" / "Sincronizar
 * tudo". Corpo opcional: `{ completa: true }` força a listagem completa de
 * clientes (que o ciclo só faz uma vez por dia).
 *
 * Responde 202 e trabalha em `after()`: é o MESMO código do cron. O balde é
 * apertado porque cada clique varre a conta do Asaas, cuja cota é da CONTA,
 * dividida com qualquer outro sistema do escritório.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:sync:${ctx.userId}`, RATE_LIMITS.asaasLevantamento);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { completa?: unknown } | null;
    const completa = corpo?.completa === true;

    after(async () => {
      const r = await sincronizarAsaas(supabaseAdmin(), ctx.accountId, { completa });
      if (r.ok) {
        console.log(
          `[asaas] sincronização manual da conta ${ctx.accountId}: ${r.clientesListados} clientes listados, ${r.cobrancasGravadas} cobranças, ${r.reconciliadas} reconciliadas, ${r.ligados} ligados, ${r.fichasCriadas} fichas criadas, ${r.adiadas} adiadas`,
        );
      }
    });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
