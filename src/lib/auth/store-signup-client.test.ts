import { describe, it, expect, vi, beforeEach } from "vitest";

import { submitStoreSignup, type MinimalSignupClient } from "./store-signup-client";

// ---------------------------------------------------------------------------
// The store-owner "Criar conta" path on /signup (no invite token). Critical
// properties under test:
//   (a) client-side validation (password mismatch/length, missing store
//       name) never reaches Supabase at all.
//   (b) a duplicate email surfaces Supabase's own clear error, without
//       ever calling the organization-bootstrap endpoint.
//   (c) a successful signUp() always triggers the bootstrap call with the
//       new user's id + store name.
//   (d) a bootstrap failure is surfaced as an error, not silently ignored.
//   (e) the "already has a live session" (auto-confirm) vs "check your
//       email" (confirmation required) outcomes are told apart correctly.
// ---------------------------------------------------------------------------

const ORIGIN = "https://app.example.com";

function makeSupabase(opts: {
  signUpError?: { message: string } | null;
  userId?: string | null;
  session?: unknown | null;
}): { client: MinimalSignupClient; signUp: ReturnType<typeof vi.fn> } {
  const signUp = vi.fn(async () => ({
    data: {
      user: opts.userId === undefined ? { id: "user-new-1" } : opts.userId ? { id: opts.userId } : null,
      session: opts.session ?? null,
    },
    error: opts.signUpError ?? null,
  }));
  return { client: { auth: { signUp } }, signUp };
}

const validInput = {
  fullName: "João da Silva",
  storeName: "Loja de Veículos Silva",
  email: "joao@example.com",
  password: "senha123",
  confirmPassword: "senha123",
};

describe("submitStoreSignup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a password mismatch before ever calling signUp", async () => {
    const { client, signUp } = makeSupabase({});
    const result = await submitStoreSignup(
      client,
      { ...validInput, confirmPassword: "different" },
      ORIGIN,
    );
    expect(result).toEqual({ status: "error", error: "As senhas não coincidem" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a too-short password before ever calling signUp", async () => {
    const { client, signUp } = makeSupabase({});
    const result = await submitStoreSignup(
      client,
      { ...validInput, password: "abc", confirmPassword: "abc" },
      ORIGIN,
    );
    expect(result.status).toBe("error");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a missing store name before ever calling signUp", async () => {
    const { client, signUp } = makeSupabase({});
    const result = await submitStoreSignup(client, { ...validInput, storeName: "  " }, ORIGIN);
    expect(result).toEqual({ status: "error", error: "Informe o nome da sua loja ou negócio" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("surfaces Supabase's own duplicate-email error clearly, without calling the bootstrap endpoint", async () => {
    const { client } = makeSupabase({
      signUpError: { message: "User already registered" },
    });
    const fetchImpl = vi.fn();

    const result = await submitStoreSignup(client, validInput, ORIGIN, fetchImpl);

    expect(result).toEqual({ status: "error", error: "User already registered" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls the bootstrap endpoint with the new user's id and store name on success", async () => {
    const { client } = makeSupabase({ userId: "user-abc" });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({ organization: {} }), { status: 201 });
    });

    await submitStoreSignup(client, validInput, ORIGIN, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/auth/store-signup");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      userId: "user-abc",
      storeName: "Loja de Veículos Silva",
    });
  });

  it("uses the WhatsApp-connect step as the email confirmation redirect", async () => {
    const { client } = makeSupabase({ userId: "user-abc" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 }));

    await submitStoreSignup(client, validInput, ORIGIN, fetchImpl);

    const signUpCall = (client.auth.signUp as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(signUpCall.options.emailRedirectTo).toBe(
      `${ORIGIN}/auth/callback?next=${encodeURIComponent("/settings?tab=whatsapp")}`,
    );
  });

  it("surfaces a bootstrap failure as an error instead of silently succeeding", async () => {
    const { client } = makeSupabase({ userId: "user-abc" });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "Store name is required." }), { status: 400 }),
    );

    const result = await submitStoreSignup(client, validInput, ORIGIN, fetchImpl);

    expect(result).toEqual({ status: "error", error: "Store name is required." });
  });

  it("returns 'signed-in' when signUp() already granted a live session (auto-confirm enabled)", async () => {
    const { client } = makeSupabase({ userId: "user-abc", session: { access_token: "x" } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 }));

    const result = await submitStoreSignup(client, validInput, ORIGIN, fetchImpl);

    expect(result).toEqual({ status: "signed-in" });
  });

  it("returns 'check-email' when no session is granted (email confirmation required)", async () => {
    const { client } = makeSupabase({ userId: "user-abc", session: null });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 }));

    const result = await submitStoreSignup(client, validInput, ORIGIN, fetchImpl);

    expect(result).toEqual({ status: "check-email" });
  });
});
