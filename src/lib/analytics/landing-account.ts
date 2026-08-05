// ============================================================
// landing-account — resuelve el account_id de la landing (eventos
// anónimos de /api/events y /api/track). DAD §9.1: "los eventos
// anónimos tienen account_id de la clínica".
//
// El deploy es single-account (una clínica por instancia, verificado:
// 1 fila en public.accounts). Resolución: env var LANDING_ACCOUNT_ID
// si está definida (multi-instancia explícita), si no la primera
// cuenta creada (order by created_at). Memoizada por proceso.
//
// Nunca se expone al cliente: corre SOLO server-side con service role.
// ============================================================

import { supabaseAdmin } from "@/lib/automations/admin-client";

let _cached: string | null | undefined;

export async function resolveLandingAccountId(): Promise<string | null> {
  if (_cached !== undefined) return _cached;

  if (process.env.LANDING_ACCOUNT_ID) {
    _cached = process.env.LANDING_ACCOUNT_ID;
    return _cached;
  }

  const { data, error } = await supabaseAdmin()
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error("[analytics] resolveLandingAccountId error:", error);
    _cached = null;
    return null;
  }
  _cached = data.id;
  return _cached ?? null;
}