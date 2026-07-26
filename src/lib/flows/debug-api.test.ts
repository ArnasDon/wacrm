import { describe, expect, it, vi } from "vitest";

import { debugRpcError } from "./debug-api";

describe("debug API error boundary", () => {
  it("logs a sanitized server context and never returns raw database text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = debugRpcError(
      {
        message:
          'duplicate key violates constraint sessions_token_secret="abc"',
        code: "23505",
      },
      { operation: "create_session", flowId: "flow-1", token: "hidden" },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "DEBUG_STORAGE_ERROR",
      error: "The debug operation could not be completed.",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("abc");
    expect(JSON.stringify(log.mock.calls)).not.toContain("hidden");
    log.mockRestore();
  });

  it("returns stable conflict, quota and rate-limit codes", async () => {
    const conflict = debugRpcError({ message: "debug_revision_conflict" });
    const quota = debugRpcError({ message: "debug_session_quota" });
    const rate = debugRpcError({ message: "debug_edit_rate_limited" });

    expect(await conflict.json()).toMatchObject({
      code: "DEBUG_REVISION_CONFLICT",
    });
    expect(quota.status).toBe(429);
    expect(await quota.json()).toMatchObject({ code: "DEBUG_SESSION_QUOTA" });
    expect(rate.status).toBe(429);
    expect(await rate.json()).toMatchObject({ code: "DEBUG_RATE_LIMITED" });
  });
});
