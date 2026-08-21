// ============================================================
// Client-side login logic for /painel-a17c94fe2b6d/login — extracted
// out of the page component so it's unit-testable without rendering
// React (this repo has no component-test harness; every other piece
// of business logic already lives in a plain lib/ function for the
// same reason).
//
// This is the SAME Supabase Auth user base as the normal CRM login —
// not a separate auth system. The only thing special about this page
// is what happens right after a successful sign-in: a platform-admin
// check, with an immediate sign-out on failure so a non-admin can
// never end up sitting on an authenticated-but-not-admin session on
// what's supposed to be an admin-only entry point. (/painel-a17c94fe2b6d
// itself still independently 404s a non-admin server-side via
// requirePlatformAdmin() — this is defense in depth, not the only
// guard.)
// ============================================================

export interface MinimalSupabaseAuthClient {
  auth: {
    signInWithPassword(creds: {
      email: string;
      password: string;
    }): PromiseLike<{ error: { message: string } | null }>;
    signOut(): PromiseLike<{ error: { message: string } | null }>;
    getSession(): PromiseLike<{ data: { session: { user: { id: string } } | null } }>;
  };
  rpc(fn: "is_platform_admin"): PromiseLike<{ data: boolean | null; error: unknown }>;
}

export interface PlatformLoginResult {
  ok: boolean;
  error?: string;
}

const NOT_ADMIN_MESSAGE =
  "Esta conta não tem acesso ao painel da plataforma.";

/**
 * Sign in, then verify platform-admin status. On any failure —
 * wrong credentials, or valid credentials for a non-admin account —
 * the caller ends up signed out and gets a clear, single error
 * message. Never returns `ok: true` with the caller still logged out.
 */
export async function signInAsPlatformAdmin(
  supabase: MinimalSupabaseAuthClient,
  email: string,
  password: string,
): Promise<PlatformLoginResult> {
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    return { ok: false, error: signInError.message };
  }

  return verifyPlatformAdminOrSignOut(supabase);
}

/**
 * Confirms the CURRENT session belongs to a platform admin. If not —
 * whether the RPC says false or errors — signs the session out. Used
 * both right after signInAsPlatformAdmin's own sign-in, and on mount
 * to clean up a stale non-admin session someone might already have
 * (e.g. signed into the normal CRM in another tab, then navigated
 * straight to this admin login page).
 */
export async function verifyPlatformAdminOrSignOut(
  supabase: MinimalSupabaseAuthClient,
): Promise<PlatformLoginResult> {
  const { data: isAdmin, error: rpcError } = await supabase.rpc("is_platform_admin");

  if (rpcError || !isAdmin) {
    await supabase.auth.signOut();
    return { ok: false, error: NOT_ADMIN_MESSAGE };
  }

  return { ok: true };
}
