// ============================================================
// Client-side orchestration for the store-owner "Criar conta" path
// on /signup (no invite token — see that page's own comment on how
// it tells a store owner apart from a seller/team-member invite).
// Extracted into a plain, unit-testable function for the same reason
// platform-login.ts is: this repo has no component-test harness, so
// business logic that needs automated coverage lives in lib/, not
// inline inside the page's event handler.
// ============================================================

export interface MinimalSignupClient {
  auth: {
    signUp(args: {
      email: string;
      password: string;
      options: { data: { full_name: string }; emailRedirectTo: string };
    }): PromiseLike<{
      data: { user: { id: string } | null; session: unknown | null };
      error: { message: string } | null;
    }>;
  };
}

export interface StoreSignupInput {
  fullName: string;
  storeName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export type StoreSignupResult =
  | { status: "error"; error: string }
  /** Some Supabase projects auto-confirm — signUp() already returned a live session. */
  | { status: "signed-in" }
  /** Email confirmation required — show the "check your email" screen. */
  | { status: "check-email" };

const MIN_PASSWORD_LEN = 6;

/**
 * Validates the form, creates the Supabase Auth user via the public
 * `signUp()` API (so Supabase's own built-in "confirm your email"
 * delivery + duplicate-email rejection keep working exactly as they
 * do today for every other signup on this page), then — for the
 * store-owner path only — bootstraps the organization via
 * POST /api/auth/store-signup.
 */
export async function submitStoreSignup(
  supabase: MinimalSignupClient,
  input: StoreSignupInput,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoreSignupResult> {
  const { fullName, storeName, email, password, confirmPassword } = input;

  if (password !== confirmPassword) {
    return { status: "error", error: "As senhas não coincidem" };
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return { status: "error", error: "A senha deve ter no mínimo 6 caracteres" };
  }
  if (!storeName.trim()) {
    return { status: "error", error: "Informe o nome da sua loja ou negócio" };
  }

  const emailRedirectTo = `${origin}/auth/callback?next=${encodeURIComponent("/settings?tab=whatsapp")}`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo },
  });

  if (error) {
    // Supabase's own message for this case ("User already registered")
    // is already clear and safe to show as-is — same behavior this
    // page has always had for a duplicate email.
    return { status: "error", error: error.message };
  }
  if (!data.user) {
    return { status: "error", error: "Não foi possível criar a conta. Tente novamente." };
  }

  const bootstrapRes = await fetchImpl("/api/auth/store-signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: data.user.id, storeName: storeName.trim() }),
  });

  if (!bootstrapRes.ok) {
    const payload = await bootstrapRes.json().catch(() => ({}));
    return {
      status: "error",
      error:
        payload.error ||
        "Conta criada, mas não foi possível configurar sua loja. Contate o suporte.",
    };
  }

  return data.session ? { status: "signed-in" } : { status: "check-email" };
}
