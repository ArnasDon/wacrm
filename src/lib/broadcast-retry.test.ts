import { describe, expect, it } from "vitest";

import { BATCH_SEND_ATTEMPTS, batchRetryDelayMs } from "./broadcast-retry";

describe("batchRetryDelayMs", () => {
  it("waits out a 429 for the advertised Retry-After", () => {
    expect(batchRetryDelayMs(429, "12")).toBe(12_000);
  });

  it("falls back to a fixed wait when Retry-After is missing or junk", () => {
    expect(batchRetryDelayMs(429, null)).toBe(5_000);
    expect(batchRetryDelayMs(429, "soon")).toBe(5_000);
    expect(batchRetryDelayMs(429, "0")).toBe(5_000);
    expect(batchRetryDelayMs(429, "-3")).toBe(5_000);
  });

  it("clamps an absurd Retry-After", () => {
    expect(batchRetryDelayMs(429, "86400")).toBe(120_000);
  });

  it.each([400, 401, 403, 404, 422, 500, 502, 503, 504])(
    "does not replay a %i — the batch may already have reached Meta",
    (status) => {
      expect(batchRetryDelayMs(status, "1")).toBeNull();
    },
  );

  it("allows a few attempts, not an unbounded loop", () => {
    expect(BATCH_SEND_ATTEMPTS).toBeGreaterThan(1);
    expect(BATCH_SEND_ATTEMPTS).toBeLessThan(10);
  });
});
