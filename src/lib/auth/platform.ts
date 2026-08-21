// ============================================================
// Platform admin context — a separate privilege axis from
// AccountContext (account.ts). An account_role is scoped to one
// account; an organization owner (migration 041) is scoped to one
// store + its linked sellers; a platform admin (migration 042) sees
// every account/organization on the whole deployment.
//
// Nobody is a platform admin by default — see
// supabase/migrations/042_platform_admin.sql for how the first one
// is added (a manual SQL insert, never through the app).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "./account";

export interface PlatformAdminContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. */
  userId: string;
}

/**
 * Resolve the caller and verify they're a platform admin.
 *
 * Throws `UnauthorizedError` if there's no Supabase session, or
 * `ForbiddenError` if the caller isn't in `platform_admins`. Every
 * route under /api/platform/* and the /painel-a17c94fe2b6d page itself
 * must call this before doing anything else — callers should treat
 * a caught error here as "act like this route doesn't exist" (404),
 * not a permission-denied screen that confirms the route's existence.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  // platform_admins' only RLS policy lets a caller see their OWN row
  // (see the migration) — this never leaks the admin roster to a
  // non-admin, it just tells them whether their own row exists.
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[requirePlatformAdmin] lookup error:", error);
    throw new ForbiddenError("Not a platform admin");
  }
  if (!data) {
    throw new ForbiddenError("Not a platform admin");
  }

  return { supabase, userId: user.id };
}
