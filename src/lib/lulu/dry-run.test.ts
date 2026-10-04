import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMPAIGN_ROWS,
  DEFAULT_POLICY,
  campaignFromRow,
  decideNextBestAction,
  runDryRun,
  thresholdsFromCampaigns,
  type CampaignConfig,
  type CampaignRow,
  type DryRunProfileRow,
} from "./index";

const NOW = new Date("2026-09-24T12:00:00Z");

const campaigns: CampaignConfig[] = DEFAULT_CAMPAIGN_ROWS.map((r, i) =>
  campaignFromRow({
    id: `id${i}`, campaign_code: r.campaign_code, name: r.name,
    campaign_type: r.campaign_type, rule_params: { ...r.rule_params },
    offer_id: null, active: true,
  } as CampaignRow),
);

const row = (o: Partial<DryRunProfileRow>): DryRunProfileRow => ({
  customer_id: "c", mobile: "+966500000000", name: "N", language: "ar", birthday: null,
  last_order_date: "2026-09-01", total_orders: 1, total_sales: 100, median_interval_days: null,
  vip_flag: false, marketing_opt_in: true, active_complaint: false, suspect_reason: null,
  preferred_store: null, ...o,
});

describe("campaign defaults", () => {
  it("maps types to PRD priority classes", () => {
    const by = Object.fromEntries(campaigns.map((c) => [c.code, c.priorityClass]));
    expect(by).toMatchObject({ VIP_PROTECTION: "VIP", WINBACK_30: "WINBACK", SECOND_ORDER: "PERSONALIZED_OFFER" });
  });
  it("thresholds are driven by campaign params", () => {
    const custom = campaigns.map((c) => (c.code === "WINBACK_30" ? { ...c, params: { winbackDays: 45 } } : c));
    expect(thresholdsFromCampaigns(custom).dormantDays).toBe(45);
    expect(thresholdsFromCampaigns(campaigns).atRiskDays).toBe(15);
  });
});

describe("single-order customers", () => {
  const run = (lastOrder: string) =>
    decideNextBestAction({
      profile: {
        customerId: "c", mobile: "+966500000000", language: "ar", totalOrders: 1, totalSales: 100,
        lastOrderDate: lastOrder, vipFlag: false, marketingOptIn: true, activeComplaint: false,
      },
      campaigns, policy: DEFAULT_POLICY, history: [], now: NOW,
    });
  it("days 7–29: second-order reminder, not the generic 15-day message", () => {
    expect(run("2026-09-17").action?.campaignCode).toBe("SECOND_ORDER"); // 7 days
    expect(run("2026-09-02").action?.campaignCode).toBe("SECOND_ORDER"); // 22 days
    expect(run("2026-09-02").skipped.some((s) => s.campaignCode === "INACTIVE_15")).toBe(false);
  });
  it("day 30+: win-back takes over", () => {
    expect(run("2026-08-20").action?.campaignCode).toBe("WINBACK_30"); // 35 days
    expect(run("2026-06-30").action?.campaignCode).toBe("LOST_60"); // 86 days
  });
  it("before day 7: nothing", () => {
    expect(run("2026-09-20").action).toBeNull();
  });
});

describe("runDryRun", () => {
  const rows = [
    row({ customer_id: "a", total_orders: 1, last_order_date: "2026-09-02" }), // SECOND_ORDER
    row({ customer_id: "b", total_orders: 4, last_order_date: "2026-08-20", median_interval_days: 10 }), // 35d, 3.5x → DORMANT
    row({ customer_id: "c", total_orders: 10, last_order_date: "2026-09-05", median_interval_days: 10, vip_flag: true }), // VIP wins over winback
    row({ customer_id: "d", total_orders: 1, last_order_date: "2026-09-02", marketing_opt_in: false }), // blocked
    row({ customer_id: "e", total_orders: 1, last_order_date: "2026-09-02", suspect_reason: "many_names:9" }), // suspect
    row({ customer_id: "f", total_orders: 5, last_order_date: "2026-09-24", median_interval_days: 3 }), // ordered today, nothing matches
  ];
  const rep = runDryRun(rows, campaigns, DEFAULT_POLICY, NOW);
  const c = (code: string) => rep.campaigns.find((x) => x.code === code)!;

  it("counts suspects separately and excludes them from everything else", () => {
    expect(rep.suspects).toBe(1);
    expect(Object.values(rep.lifecycle).reduce((a, b) => a + b, 0)).toBe(5);
  });
  it("selects per campaign and reports why others were blocked", () => {
    expect(c("SECOND_ORDER").selected).toBe(1);
    expect(c("SECOND_ORDER").blocked.opted_out).toBe(1);
    expect(c("WINBACK_30").selected).toBe(1);
    expect(c("VIP_PROTECTION").selected).toBe(1);
    expect(c("VIP_PROTECTION").samples[0].customerId).toBe("c");
  });
  it("VIP overdue customer is not double-counted: winback loses on priority", () => {
    expect(c("INACTIVE_15").blocked.lower_priority).toBe(1);
    expect(rep.customersWithAction).toBe(3);
    expect(rep.customersWithoutAction).toBe(2); // d (blocked) + f (no match)
  });
});
