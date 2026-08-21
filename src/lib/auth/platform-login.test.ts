import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  signInAsPlatformAdmin,
  verifyPlatformAdminOrSignOut,
  type MinimalSupabaseAuthClient,
} from "./platform-login";

// ---------------------------------------------------------------------------
// /painel-a17c94fe2b6d/login's core logic — the property under test that
// matters most: a successful Supabase sign-in for a NON platform-admin
// account must never leave the caller signed in. Either the credentials are
// wrong (sign-in itself fails) or the account isn't a platform admin (we
// sign back out immediately) — there is no path that returns `ok: true`
// while leaving a non-admin session behind.
// ---------------------------------------------------------------------------

function makeClient(opts: {
  signInError?: { message: string } | null;
  isAdmin?: boolean | null;
  rpcError?: unknown;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const signInWithPassword = vi.fn(async () => ({
    error: opts.signInError ?? null,
  }));
  const rpc = vi.fn(async () => ({
    data: opts.isAdmin ?? false,
    error: opts.rpcError ?? null,
  }));
  const getSession = vi.fn(async () => ({ data: { session: null } }));

  const client: MinimalSupabaseAuthClient = {
    auth: { signInWithPassword, signOut, getSession },
    rpc,
  };

  return { client, signOut, signInWithPassword, rpc };
}

describe("signInAsPlatformAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails without ever calling the admin RPC when credentials are wrong", async () => {
    const { client, rpc, signOut } = makeClient({
      signInError: { message: "Invalid login credentials" },
    });

    const result = await signInAsPlatformAdmin(client, "x@example.com", "wrong");

    expect(result).toEqual({ ok: false, error: "Invalid login credentials" });
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs the session back out and errors when the account is authenticated but not a platform admin", async () => {
    const { client, signOut } = makeClient({ isAdmin: false });

    const result = await signInAsPlatformAdmin(client, "regular@example.com", "correct");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/não tem acesso ao painel da plataforma/i);
    // The critical assertion: the sign-in itself "worked" at the Supabase
    // Auth level, but this must never leave the caller logged in.
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out and errors when the is_platform_admin RPC itself errors, rather than assuming access", async () => {
    const { client, signOut } = makeClient({ isAdmin: null, rpcError: { message: "boom" } });

    const result = await signInAsPlatformAdmin(client, "x@example.com", "correct");

    expect(result.ok).toBe(false);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("resolves ok and leaves the session intact for a real platform admin", async () => {
    const { client, signOut } = makeClient({ isAdmin: true });

    const result = await signInAsPlatformAdmin(client, "admin@example.com", "correct");

    expect(result).toEqual({ ok: true });
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("verifyPlatformAdminOrSignOut", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs out a non-admin's existing session", async () => {
    const { client, signOut } = makeClient({ isAdmin: false });
    const result = await verifyPlatformAdminOrSignOut(client);
    expect(result.ok).toBe(false);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("leaves a platform admin's existing session intact", async () => {
    const { client, signOut } = makeClient({ isAdmin: true });
    const result = await verifyPlatformAdminOrSignOut(client);
    expect(result.ok).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
  });
});
