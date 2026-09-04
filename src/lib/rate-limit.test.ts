import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimitForTests,
  checkCatalogExternalBudget,
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from "./rate-limit";

const OPTS = { limit: 3, windowMs: 60_000 };

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("permits the first request and decrements remaining", () => {
    const result = checkRateLimit("user:1", OPTS);
    expect(result).toMatchObject({
      success: true,
      remaining: 2,
      limit: 3,
    });
    expect(result.reset).toBeGreaterThan(Date.now());
  });

  it("permits exactly `limit` requests then rejects the next", () => {
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    const over = checkRateLimit("user:1", OPTS);
    expect(over.success).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("keeps separate counters per key", () => {
    checkRateLimit("user:1", OPTS);
    checkRateLimit("user:1", OPTS);
    checkRateLimit("user:1", OPTS);
    // user:1 is at the cap, user:2 should still be unaffected.
    const other = checkRateLimit("user:2", OPTS);
    expect(other.success).toBe(true);
    expect(other.remaining).toBe(2);
  });

  it("opens a fresh window after `windowMs` elapses", () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-05-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);
      __resetRateLimitForTests();

      checkRateLimit("user:1", OPTS);
      checkRateLimit("user:1", OPTS);
      checkRateLimit("user:1", OPTS);
      expect(checkRateLimit("user:1", OPTS).success).toBe(false);

      // Jump just past the window.
      vi.setSystemTime(t0 + OPTS.windowMs + 1);
      const refreshed = checkRateLimit("user:1", OPTS);
      expect(refreshed.success).toBe(true);
      expect(refreshed.remaining).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rateLimitResponse", () => {
  it("returns a 429 with retry / X-RateLimit headers", async () => {
    const reset = Date.now() + 30_000;
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset,
      limit: 60,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rate limit/i);
  });

  it("clamps Retry-After to a minimum of 1 second", () => {
    // Reset already in the past — the ceiling math would otherwise give 0.
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset: Date.now() - 5_000,
      limit: 10,
    });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});

describe("RATE_LIMITS presets", () => {
  it("send and broadcast are budgeted per minute", async () => {
    __resetRateLimitForTests();
    // Importing here so the presets stay close to their assertions.
    const { RATE_LIMITS } = await import("./rate-limit");
    expect(RATE_LIMITS.send.windowMs).toBe(60_000);
    expect(RATE_LIMITS.broadcast.windowMs).toBe(60_000);
  });

  it("the broadcast budget carries a campaign's per-batch call pattern", async () => {
    __resetRateLimitForTests();
    const { RATE_LIMITS } = await import("./rate-limit");
    // A campaign is NOT one call: the wizard posts a batch of 10
    // recipients roughly every 1–2 s, so it needs ~45+ calls of headroom
    // per minute. Sized below that, every batch past the cap comes back
    // 429 and its recipients are written off as failed (issue #472).
    expect(RATE_LIMITS.broadcast.limit).toBeGreaterThanOrEqual(45);
  });
});

// ============================================================
// checkCatalogExternalBudget — external catalog provider (Budun) rate
// limiting, next phase after FASE 6. Reuses checkRateLimit verbatim
// (same fixed-window Map, same single-instance caveat already
// documented at the top of this file) — these tests cover the
// account-isolation + within/over-budget scenarios (1-3 of the mandatory
// matrix); scenarios that need real resolver/provider wiring (4, 6, 7,
// 9, 10) live in catalog/resolver.test.ts and tools/catalog-tools.test.ts
// instead.
// ============================================================
describe("checkCatalogExternalBudget", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("1. a cuenta puede realizar llamadas externas dentro del límite", () => {
    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) {
      expect(checkCatalogExternalBudget("acct-1")).toBe(true);
    }
  });

  it("2. una cuenta es bloqueada al superar el límite", () => {
    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) {
      checkCatalogExternalBudget("acct-1");
    }
    expect(checkCatalogExternalBudget("acct-1")).toBe(false);
  });

  it("3. la cuenta B conserva su propio presupuesto aunque la cuenta A haya agotado el suyo", () => {
    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) {
      checkCatalogExternalBudget("acct-A");
    }
    expect(checkCatalogExternalBudget("acct-A")).toBe(false);
    expect(checkCatalogExternalBudget("acct-B")).toBe(true);
  });

  it("opens a fresh window after windowMs elapses, same as the generic limiter", () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-05-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);
      __resetRateLimitForTests();
      for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) {
        checkCatalogExternalBudget("acct-1");
      }
      expect(checkCatalogExternalBudget("acct-1")).toBe(false);
      vi.setSystemTime(t0 + RATE_LIMITS.catalogExternalAccount.windowMs + 1);
      expect(checkCatalogExternalBudget("acct-1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  __resetRateLimitForTests();
});
