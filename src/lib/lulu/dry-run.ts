import { lifecycleStage, thresholdsFromCampaigns } from "./lifecycle";
import { decideNextBestAction } from "./next-best-action";
import type {
  CampaignConfig,
  ContactPolicy,
  CustomerProfile,
  LifecycleStage,
} from "./types";

/** Columns of lulu_customer_profiles the dry run reads. */
export interface DryRunProfileRow {
  customer_id: string;
  mobile: string;
  name: string | null;
  language: string;
  birthday: string | null;
  last_order_date: string | null;
  total_orders: number;
  total_sales: number | string;
  median_interval_days: number | string | null;
  vip_flag: boolean;
  marketing_opt_in: boolean;
  active_complaint: boolean;
  suspect_reason: string | null;
  preferred_store: string | null;
}

export function profileFromRow(r: DryRunProfileRow): CustomerProfile {
  return {
    customerId: r.customer_id,
    mobile: r.mobile,
    name: r.name,
    language: r.language,
    birthday: r.birthday,
    lastOrderDate: r.last_order_date,
    totalOrders: r.total_orders,
    totalSales: Number(r.total_sales),
    medianIntervalDays: r.median_interval_days === null ? null : Number(r.median_interval_days),
    vipFlag: r.vip_flag,
    marketingOptIn: r.marketing_opt_in,
    activeComplaint: r.active_complaint,
    suspectReason: r.suspect_reason,
    preferredStore: r.preferred_store,
  };
}

export interface DryRunSample {
  customerId: string;
  mobile: string;
  name: string | null;
  reason: string;
}

export interface CampaignDryRun {
  code: string;
  name: string;
  /** Customers whose trigger matched this campaign. */
  matched: number;
  /** Customers for whom this campaign would actually be sent. */
  selected: number;
  /** Matched but not sent, by reason (opted_out, ordered_recently, lower_priority, …). */
  blocked: Record<string, number>;
  samples: DryRunSample[];
}

export interface DryRunReport {
  asOf: string;
  profiles: number;
  suspects: number;
  lifecycle: Record<LifecycleStage, number>;
  campaigns: CampaignDryRun[];
  customersWithAction: number;
  customersWithoutAction: number;
}

const SAMPLES_PER_CAMPAIGN = 5;
// Last-order dates carry no time; assume the END of that Riyadh day so a customer who
// ordered "today" is always treated as ordered-recently.
const endOfOrderDay = (d: string) => new Date(`${d}T23:59:59+03:00`);

/**
 * Simulate the engine over the whole customer base. Sends nothing and writes
 * nothing. All given campaigns are simulated regardless of their `active`
 * flag (the flag controls live sending, not previews). Message history is
 * empty until the sender exists, so frequency caps cannot trigger yet.
 */
export function runDryRun(
  rows: DryRunProfileRow[],
  campaigns: CampaignConfig[],
  policy: ContactPolicy,
  now: Date,
): DryRunReport {
  const sim = campaigns.map((c) => ({ ...c, active: true }));
  const thresholds = thresholdsFromCampaigns(sim);
  const byCode = new Map<string, CampaignDryRun>(
    sim.map((c) => [c.code, { code: c.code, name: c.name ?? c.code, matched: 0, selected: 0, blocked: {}, samples: [] }]),
  );
  const lifecycle: Record<LifecycleStage, number> = {
    NEW: 0, FIRST_ORDER: 0, ACTIVE: 0, AT_RISK: 0, DORMANT: 0, LOST: 0,
  };
  let suspects = 0;
  let withAction = 0;
  let withoutAction = 0;

  for (const row of rows) {
    if (row.suspect_reason) {
      suspects++;
      continue;
    }
    const profile = profileFromRow(row);
    lifecycle[lifecycleStage(profile, now, thresholds)]++;

    const result = decideNextBestAction({
      profile,
      campaigns: sim,
      policy,
      history: [],
      now,
      lastOrderAt: row.last_order_date ? endOfOrderDay(row.last_order_date) : null,
    });

    for (const s of result.skipped) {
      const c = byCode.get(s.campaignCode);
      if (!c) continue;
      c.matched++;
      c.blocked[s.reason] = (c.blocked[s.reason] ?? 0) + 1;
    }
    if (result.action) {
      withAction++;
      const c = byCode.get(result.action.campaignCode)!;
      c.matched++;
      c.selected++;
      if (c.samples.length < SAMPLES_PER_CAMPAIGN) {
        c.samples.push({
          customerId: profile.customerId,
          mobile: profile.mobile,
          name: profile.name ?? null,
          reason: result.action.reason,
        });
      }
    } else {
      withoutAction++;
    }
  }

  return {
    asOf: now.toISOString(),
    profiles: rows.length,
    suspects,
    lifecycle,
    campaigns: [...byCode.values()],
    customersWithAction: withAction,
    customersWithoutAction: withoutAction,
  };
}
