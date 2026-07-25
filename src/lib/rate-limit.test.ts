import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  rateLimitResponse,
} from "./rate-limit";

const OPTS = { limit: 3, windowMs: 60_000 };

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}));

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rpc.mockResolvedValue({
      data: [
        {
          success: true,
          remaining: 2,
          reset_at: "2026-07-25T17:00:00.000Z",
          bucket_limit: 3,
        },
      ],
      error: null,
    });
  });

  it("uses the shared Postgres bucket without storing the raw key", async () => {
    const result = await checkRateLimit("user:1", OPTS);

    expect(result).toMatchObject({
      success: true,
      remaining: 2,
      limit: 3,
    });
    expect(result.reset).toBe(Date.parse("2026-07-25T17:00:00.000Z"));
    expect(h.rpc).toHaveBeenCalledWith("claim_rate_limit_slot", {
      p_bucket_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_limit: 3,
      p_window_ms: 60_000,
    });
    expect(JSON.stringify(h.rpc.mock.calls[0])).not.toContain("user:1");
  });

  it("returns a denied decision from the shared store", async () => {
    h.rpc.mockResolvedValue({
      data: [
        {
          success: false,
          remaining: 0,
          reset_at: "2026-07-25T17:00:00.000Z",
          bucket_limit: 3,
        },
      ],
      error: null,
    });

    await expect(checkRateLimit("user:1", OPTS)).resolves.toMatchObject({
      success: false,
      remaining: 0,
      limit: 3,
    });
  });

  it("returns an unavailable decision when the shared store fails", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    await expect(checkRateLimit("user:1", OPTS)).resolves.toMatchObject({
      success: false,
      unavailable: true,
      remaining: 0,
      limit: 3,
    });
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

  it("returns 503 instead of disguising a store outage as client throttling", async () => {
    const res = rateLimitResponse({
      success: false,
      unavailable: true,
      remaining: 0,
      reset: Date.now() + 1_000,
      limit: 10,
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Rate limit service unavailable",
      code: "rate_limit_unavailable",
    });
  });
});

describe("RATE_LIMITS presets", () => {
  it("send and broadcast budgets are independent", async () => {
    // Importing here so the presets stay close to their assertions.
    const { RATE_LIMITS } = await import("./rate-limit");
    expect(RATE_LIMITS.send.limit).toBeGreaterThan(RATE_LIMITS.broadcast.limit);
    expect(RATE_LIMITS.send.windowMs).toBe(60_000);
    expect(RATE_LIMITS.broadcast.windowMs).toBe(60_000);
  });
});
