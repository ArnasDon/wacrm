import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// GET /auth/callback — closes AUTH-N1. Never had a test file before
// (the route never existed). `createClient()` (SSR client) is mocked
// so these tests control exchangeCodeForSession's outcome directly,
// without a real Supabase project.
// ============================================================

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  }),
}));

import { GET } from "./route";

function reqWith(query: string): Request {
  return new Request(`https://app.example.com/auth/callback${query}`);
}

beforeEach(() => {
  mocks.exchangeCodeForSession.mockReset();
});

describe("GET /auth/callback", () => {
  // AUTH-N1.1
  it("valid code: exchanges it and redirects to next", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(reqWith("?code=real-code-123&next=/reset-password"));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("real-code-123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/reset-password",
    );
  });

  // AUTH-N1.2
  it("no code at all: redirects to /login, never calls exchangeCodeForSession", async () => {
    const res = await GET(reqWith("?next=/reset-password"));

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://app.example.com/login");
  });

  // AUTH-N1.3
  it("invalid/expired code: redirects to /login with a generic outcome, no internal detail exposed", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid or expired code (internal GoTrue detail)" },
    });

    const res = await GET(reqWith("?code=stale-code&next=/reset-password"));

    expect(res.headers.get("location")).toBe("https://app.example.com/login");
    // The redirect itself carries no query string / body that could
    // leak the provider's internal error text to the client.
    const location = new URL(res.headers.get("location")!);
    expect(location.search).toBe("");
  });

  it("a missing code and an invalid code produce the EXACT same destination — a probe can't distinguish them", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "expired" },
    });
    const withBadCode = await GET(reqWith("?code=bad&next=/reset-password"));
    const withNoCode = await GET(reqWith("?next=/reset-password"));

    expect(withBadCode.headers.get("location")).toBe(
      withNoCode.headers.get("location"),
    );
  });

  // AUTH-N1.4
  it("next=/reset-password is honored on success", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(reqWith("?code=ok&next=/reset-password"));
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/reset-password",
    );
  });

  // AUTH-N1.5 / .6 / .7 at the route level (unit coverage of the
  // validator itself lives in safe-redirect.test.ts)
  it("an external next is never honored, even on a successful exchange", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(
      reqWith("?code=ok&next=https://evil.example/steal"),
    );
    expect(res.headers.get("location")).toBe("https://app.example.com/login");
  });

  it("a protocol-relative next is never honored", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(reqWith("?code=ok&next=//evil.example"));
    expect(res.headers.get("location")).toBe("https://app.example.com/login");
  });

  // AUTH-N1.8
  it("absent next falls back to /login on success", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(reqWith("?code=ok"));
    expect(res.headers.get("location")).toBe("https://app.example.com/login");
  });

  // AUTH-N1.13
  it("never includes the code value anywhere in the response (headers or body)", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "expired" },
    });
    const SECRET_CODE = "super-secret-recovery-code-value";

    const res = await GET(reqWith(`?code=${SECRET_CODE}&next=/reset-password`));

    const serializedHeaders = JSON.stringify([...res.headers.entries()]);
    expect(serializedHeaders).not.toContain(SECRET_CODE);
  });

  it("never logs the code value, even on failure (console.warn only carries the provider's message)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "expired" },
    });
    const SECRET_CODE = "super-secret-recovery-code-value";

    await GET(reqWith(`?code=${SECRET_CODE}&next=/reset-password`));

    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_CODE);
    }
    warn.mockRestore();
  });
});
