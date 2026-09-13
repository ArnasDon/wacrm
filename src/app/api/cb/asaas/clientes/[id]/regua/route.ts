import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/cb/asaas/clientes/[id]/regua  (admin+) — a LISTA DE EXCEÇÃO da
 * cobrança automática (998, D21): `{ desligada: true }` marca o cliente do
 * Asaas como "não cobrar automaticamente" (nem lembrete, nem marco);
 * `{ desligada: false }` desfaz. Com quem e quando CARIMBADOS (sobrevivem à
 * saída do login), como o vínculo. Por cliente do Asaas, não por contato: a
 * régua agrupa por cliente (D11) e o mesmo contato pode ter a pessoa e a
 * empresa.
 *
 * ⚠️ ROWCOUNT conferido: em service role o `.eq('account_id')` é a única
 * cerca, e um update que não achou a linha volta sem erro.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:regua-cliente:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const corpo = (await request.json().catch(() => null)) as { desligada?: unknown } | null;
    if (typeof corpo?.desligada !== "boolean") return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const { data: perfil } = await ctx.supabase.from("profiles").select("full_name, email").eq("user_id", ctx.userId).maybeSingle();
    const quem = ((perfil?.full_name as string | null) || (perfil?.email as string | null) || "").trim() || null;
    const agora = new Date().toISOString();
    const { data, error } = await supabaseAdmin()
      .from("cb_asaas_clientes")
      .update({
        regua_desligada: corpo.desligada,
        regua_desligada_por: corpo.desligada ? quem : null,
        regua_desligada_em: corpo.desligada ? agora : null,
        updated_at: agora,
      })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id");
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, desligada: corpo.desligada });
  } catch (err) {
    return toErrorResponse(err);
  }
}
