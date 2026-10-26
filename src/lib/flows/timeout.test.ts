import { describe, expect, it } from "vitest";
import { checkRunTimeout } from "./timeout";

const NOW = new Date("2026-10-16T12:00:00Z");

describe("checkRunTimeout", () => {
  it("uses the default 24h policy when the flow has none", () => {
    expect(checkRunTimeout("2026-10-15T12:00:01Z", null, NOW).timedOut).toBe(false);
    expect(checkRunTimeout("2026-10-15T12:00:00Z", null, NOW)).toEqual({
      timedOut: true,
      ageHours: 24,
      policyHours: 24,
    });
  });

  it("honours the flow's on_timeout_hours", () => {
    const policy = { on_timeout_hours: 2 };
    expect(checkRunTimeout("2026-10-16T10:30:00Z", policy, NOW).timedOut).toBe(false);
    expect(checkRunTimeout("2026-10-16T09:59:00Z", policy, NOW).timedOut).toBe(true);
  });

  it("never times out a run with an unparseable timestamp", () => {
    expect(checkRunTimeout("not a date", null, NOW).timedOut).toBe(false);
  });
});
