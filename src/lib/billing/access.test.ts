import { describe, expect, it } from "vitest";
import { isAccountBlocked } from "./access";

describe("isAccountBlocked", () => {
  it("active is never blocked", () => {
    expect(isAccountBlocked({ subscription_status: "active", trial_ends_at: null })).toBe(false);
  });

  it("past_due is always blocked", () => {
    expect(isAccountBlocked({ subscription_status: "past_due", trial_ends_at: null })).toBe(true);
  });

  it("canceled is always blocked", () => {
    expect(isAccountBlocked({ subscription_status: "canceled", trial_ends_at: null })).toBe(true);
  });

  it("trialing with trial_ends_at in the future is not blocked", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isAccountBlocked({ subscription_status: "trialing", trial_ends_at: future })).toBe(false);
  });

  it("trialing with trial_ends_at in the past is blocked", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isAccountBlocked({ subscription_status: "trialing", trial_ends_at: past })).toBe(true);
  });

  it("trialing with trial_ends_at null is not blocked (defensive — should not happen post-migration)", () => {
    expect(isAccountBlocked({ subscription_status: "trialing", trial_ends_at: null })).toBe(false);
  });
});
