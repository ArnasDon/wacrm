import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
// `authHangs`  — when true, getUser() never resolves/rejects on its own,
//               simulating GoTrue being unreachable (the production
//               incident this suite's timeout tests reproduce).
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];
let authHangs = false;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: () => {
        if (authHangs) return new Promise(() => {}); // never settles
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return Promise.resolve({ data: { user: mockUser } });
      },
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  refreshedCookies = [];
  authHangs = false;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe("middleware — public and API routes (Auth healthy)", () => {
  it("lets an unauthenticated visitor load a public route", async () => {
    mockUser = null;

    const res = await middleware(new NextRequest("https://app.test/"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("returns 401 for an unauthenticated call to a protected /api/whatsapp/* route", async () => {
    mockUser = null;

    const res = await middleware(
      new NextRequest("https://app.test/api/whatsapp/send"),
    );

    expect(res.status).toBe(401);
  });

  it("does not require auth for /api/whatsapp/webhook", async () => {
    mockUser = null;

    const res = await middleware(
      new NextRequest("https://app.test/api/whatsapp/webhook"),
    );

    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});

// Reproduces the production incident: GoTrue accepts the connection but
// never answers. Every scenario below asserts the middleware still
// settles at (approximately) AUTH_TIMEOUT_MS instead of hanging until
// Vercel's own platform ceiling turns it into a site-wide 504, and that
// a timeout is always treated as "we don't know", never as "confirmed
// logged in" — protected surfaces must fail closed.
describe("middleware — Auth timeout (GoTrue unavailable)", () => {
  it("fails closed on a protected page when Auth never responds", async () => {
    vi.useFakeTimers();
    authHangs = true;

    const pending = middleware(new NextRequest("https://app.test/dashboard"));
    await vi.advanceTimersByTimeAsync(5000);
    const res = await pending;

    // Deny, don't guess — a hung Auth call must never be treated as an
    // authenticated pass-through on a protected route.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("returns 401 on a protected /api/whatsapp/* route when Auth never responds", async () => {
    vi.useFakeTimers();
    authHangs = true;

    const pending = middleware(
      new NextRequest("https://app.test/api/whatsapp/send"),
    );
    await vi.advanceTimersByTimeAsync(5000);
    const res = await pending;

    // No accidental unauthenticated access to a protected API route.
    expect(res.status).toBe(401);
  });

  it("still lets a public page load when Auth never responds", async () => {
    vi.useFakeTimers();
    authHangs = true;

    const pending = middleware(new NextRequest("https://app.test/"));
    await vi.advanceTimersByTimeAsync(5000);
    const res = await pending;

    // A third-party Auth outage must not take down a route that never
    // gated on `user` in the first place.
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).not.toBe(401);
  });

  it("does not block the webhook path when Auth never responds", async () => {
    vi.useFakeTimers();
    authHangs = true;

    const pending = middleware(
      new NextRequest("https://app.test/api/whatsapp/webhook"),
    );
    await vi.advanceTimersByTimeAsync(5000);
    const res = await pending;

    expect(res.status).not.toBe(401);
  });

  it("does not depend on the timeout firing when Auth answers normally", async () => {
    // Sanity check that the race adds no latency to the healthy path —
    // this must resolve without ever advancing fake timers.
    vi.useFakeTimers();
    mockUser = { id: "user-1" };

    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    expect(res.headers.get("location")).toBeNull();
  });
});
