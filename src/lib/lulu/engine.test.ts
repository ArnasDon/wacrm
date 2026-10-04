import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  birthdayInWindow,
  checkContactPolicy,
  decideNextBestAction,
  idempotencyKey,
  inQuietHours,
  lifecycleStage,
  type CampaignConfig,
  type CustomerProfile,
} from "./index";

const NOW = new Date("2026-09-24T12:00:00Z");

const base: CustomerProfile = {
  customerId: "12345",
  mobile: "+966500000000",
  name: "Ahmed",
  language: "ar",
  lastOrderDate: "2026-09-05",
  totalOrders: 38,
  totalSales: 5240,
  medianIntervalDays: 10,
  vipFlag: true,
  marketingOptIn: true,
  activeComplaint: false,
};

const camp = (code: string, type: CampaignConfig["type"], priorityClass: CampaignConfig["priorityClass"], extra: Partial<CampaignConfig> = {}): CampaignConfig => ({
  id: code, code, type, priorityClass, active: true, params: {}, ...extra,
});

describe("lifecycleStage", () => {
  it("uses the customer's own cycle (PRD §34): day 15 is AT_RISK for a 7-day shopper", () => {
    const p = { ...base, medianIntervalDays: 7, lastOrderDate: "2026-09-09" };
    expect(lifecycleStage(p, NOW)).toBe("AT_RISK");
  });
  it("day 15 is ACTIVE for a 45-day shopper", () => {
    const p = { ...base, medianIntervalDays: 45, lastOrderDate: "2026-09-09" };
    expect(lifecycleStage(p, NOW)).toBe("ACTIVE");
  });
  it("falls back to fixed days with too little history", () => {
    const p = { ...base, totalOrders: 2, medianIntervalDays: null, lastOrderDate: "2026-08-20" };
    expect(lifecycleStage(p, NOW)).toBe("DORMANT"); // 35 days
  });
  it("NEW with no orders; FIRST_ORDER with one recent order", () => {
    expect(lifecycleStage({ ...base, totalOrders: 0, lastOrderDate: null }, NOW)).toBe("NEW");
    expect(lifecycleStage({ ...base, totalOrders: 1, lastOrderDate: "2026-09-20" }, NOW)).toBe("FIRST_ORDER");
  });
  it("does not flag very frequent shoppers inactive inside a week", () => {
    const p = { ...base, medianIntervalDays: 1, lastOrderDate: "2026-09-20" };
    expect(lifecycleStage(p, NOW)).toBe("ACTIVE");
  });
});

describe("birthdayInWindow", () => {
  it("matches today and a forward window", () => {
    expect(birthdayInWindow("1990-09-24", NOW)).toBe(true);
    expect(birthdayInWindow("1990-09-26", NOW, 2)).toBe(true);
    expect(birthdayInWindow("1990-09-27", NOW, 2)).toBe(false);
  });
});

describe("checkContactPolicy", () => {
  const opts = { isPromo: true };
  it("blocks opted-out and complaint customers", () => {
    expect(checkContactPolicy({ ...base, marketingOptIn: false }, DEFAULT_POLICY, NOW, [], opts).reason).toBe("opted_out");
    expect(checkContactPolicy({ ...base, activeComplaint: true }, DEFAULT_POLICY, NOW, [], opts).reason).toBe("active_complaint");
  });
  it("blocks suspected shared/fake numbers", () => {
    const v = checkContactPolicy({ ...base, suspectReason: "many_names:796" }, DEFAULT_POLICY, NOW, [], opts);
    expect(v.reason).toBe("suspected_shared_number");
  });
  it("blocks within 24h of an order", () => {
    const v = checkContactPolicy(base, DEFAULT_POLICY, NOW, [], { ...opts, lastOrderAt: new Date("2026-09-24T01:00:00Z") });
    expect(v.reason).toBe("ordered_recently");
  });
  it("enforces promo frequency cap", () => {
    const h = [1, 2, 3].map((d) => ({ sentAt: new Date(NOW.getTime() - d * 86_400_000), isPromo: true }));
    expect(checkContactPolicy(base, DEFAULT_POLICY, NOW, h, opts).reason).toBe("promo_frequency_cap");
    expect(checkContactPolicy(base, DEFAULT_POLICY, NOW, h, { isPromo: false }).allowed).toBe(true);
  });
  it("handles quiet hours wrapping midnight", () => {
    expect(inQuietHours(23, 22, 9)).toBe(true);
    expect(inQuietHours(3, 22, 9)).toBe(true);
    expect(inQuietHours(12, 22, 9)).toBe(false);
  });
});

describe("decideNextBestAction (PRD §98 worked example)", () => {
  const campaigns = [
    camp("WINBACK_15", "INACTIVE_15", "WINBACK"),
    camp("VIP_PROTECT", "VIP_PROTECTION", "VIP"),
    camp("BDAY", "BIRTHDAY", "BIRTHDAY"),
  ];
  const run = (p: CustomerProfile) =>
    decideNextBestAction({ profile: p, campaigns, policy: DEFAULT_POLICY, history: [], now: NOW });

  it("Ahmed: 19 days vs 10-day cycle → VIP outranks WINBACK per default priority", () => {
    const r = run(base);
    expect(r.action?.campaignCode).toBe("VIP_PROTECT");
    expect(r.skipped).toContainEqual({ campaignCode: "WINBACK_15", reason: "lower_priority" });
    expect(r.action?.reason).toContain("VIP");
  });
  it("priority order is configurable", () => {
    const policy = { ...DEFAULT_POLICY, priorityOrder: ["WINBACK", "VIP"] as never };
    const r = decideNextBestAction({ profile: base, campaigns, policy, history: [], now: NOW });
    expect(r.action?.campaignCode).toBe("WINBACK_15");
    expect(r.action?.reason).toBe("19 days since order vs 10-day normal cycle");
  });
  it("birthday beats everything", () => {
    expect(run({ ...base, birthday: "1985-09-24" }).action?.campaignCode).toBe("BDAY");
  });
  it("returns no action when policy blocks everything", () => {
    const r = run({ ...base, marketingOptIn: false });
    expect(r.action).toBeNull();
    expect(r.skipped.every((s) => s.reason === "opted_out")).toBe(true);
  });
  it("skips inactive campaigns and already-received ones", () => {
    const r = decideNextBestAction({
      profile: base,
      campaigns: [camp("WINBACK_15", "INACTIVE_15", "WINBACK", { active: false })],
      policy: DEFAULT_POLICY, history: [], now: NOW,
    });
    expect(r.action).toBeNull();
    const r2 = decideNextBestAction({
      profile: base, campaigns: [camp("WINBACK_15", "INACTIVE_15", "WINBACK")],
      policy: DEFAULT_POLICY, history: [], now: NOW, receivedCampaignCodes: new Set(["WINBACK_15"]),
    });
    expect(r2.skipped[0].reason).toBe("already_received_campaign");
  });
  it("idempotency key is deterministic per campaign/customer/day", () => {
    expect(idempotencyKey("WINBACK_30", "CUSTOMER12345", NOW)).toBe("WINBACK30_20260924_CUSTOMER12345");
  });
});
