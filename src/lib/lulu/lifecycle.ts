import type { CampaignConfig, CustomerProfile, LifecycleStage } from "./types";

const MS_DAY = 86_400_000;

/** Whole days between a YYYY-MM-DD date and `now` (UTC-day granularity). */
export function daysSince(date: string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const d = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(d)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - d) / MS_DAY));
}

/** Minimum orders before a personal purchase cycle is trusted (PRD §34, §66). */
export const MIN_ORDERS_FOR_CYCLE = 3;

/**
 * Overdue ratio = days since last order / the customer's own median interval.
 * Returns null when there isn't enough history — callers fall back to
 * fixed-day thresholds.
 */
export function overdueRatio(p: CustomerProfile, now: Date): number | null {
  const gap = daysSince(p.lastOrderDate, now);
  if (gap === null) return null;
  if (p.totalOrders < MIN_ORDERS_FOR_CYCLE) return null;
  const interval = p.medianIntervalDays;
  if (!interval || interval <= 0) return null;
  return gap / interval;
}

export interface LifecycleThresholds {
  atRiskDays: number;
  dormantDays: number;
  lostDays: number;
  /** Cycle-aware multiples of the customer's own interval. */
  atRiskRatio: number;
  dormantRatio: number;
  lostRatio: number;
}

export const DEFAULT_LIFECYCLE: LifecycleThresholds = {
  atRiskDays: 15,
  dormantDays: 30,
  lostDays: 60,
  atRiskRatio: 1.5,
  dormantRatio: 3,
  lostRatio: 6,
};

/**
 * NEW → FIRST_ORDER → ACTIVE → AT_RISK → DORMANT → LOST (PRD §34).
 * Uses the customer's own cycle when known, otherwise fixed days. A guard
 * keeps the cycle path from flagging someone inactive after only a few days
 * (e.g. a 2-day shopper at day 4 is not "at risk").
 */
export function lifecycleStage(
  p: CustomerProfile,
  now: Date,
  t: LifecycleThresholds = DEFAULT_LIFECYCLE,
): LifecycleStage {
  if (p.totalOrders <= 0 || !p.lastOrderDate) return "NEW";
  const gap = daysSince(p.lastOrderDate, now) ?? 0;
  if (p.totalOrders === 1 && gap < t.atRiskDays) return "FIRST_ORDER";

  const ratio = overdueRatio(p, now);
  if (ratio !== null) {
    const MIN_GAP = 7; // never inactive inside a week
    if (gap >= MIN_GAP) {
      if (ratio >= t.lostRatio) return "LOST";
      if (ratio >= t.dormantRatio) return "DORMANT";
      if (ratio >= t.atRiskRatio) return "AT_RISK";
    }
    return "ACTIVE";
  }

  if (gap >= t.lostDays) return "LOST";
  if (gap >= t.dormantDays) return "DORMANT";
  if (gap >= t.atRiskDays) return "AT_RISK";
  return totalOrdersIsOne(p) ? "FIRST_ORDER" : "ACTIVE";
}

function totalOrdersIsOne(p: CustomerProfile) {
  return p.totalOrders === 1;
}

/** True if the birthday (MM-DD) falls within `windowDays` of today (0 = today). */
export function birthdayInWindow(
  birthday: string | null | undefined,
  now: Date,
  windowDays = 0,
): boolean {
  if (!birthday) return false;
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(birthday);
  if (!m) return false;
  const month = Number(m[1]) - 1;
  const day = Number(m[2]);
  for (let off = 0; off <= windowDays; off++) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + off));
    if (t.getUTCMonth() === month && t.getUTCDate() === day) return true;
  }
  return false;
}

/** Which campaigns' triggers does this customer currently meet? (PRD §35-40, §49) */
export function matchingCampaigns(
  p: CustomerProfile,
  campaigns: CampaignConfig[],
  now: Date,
): { campaign: CampaignConfig; reason: string }[] {
  const stage = lifecycleStage(p, now);
  const gap = daysSince(p.lastOrderDate, now);
  const ratio = overdueRatio(p, now);
  const out: { campaign: CampaignConfig; reason: string }[] = [];

  for (const c of campaigns) {
    if (!c.active) continue;
    switch (c.type) {
      case "BIRTHDAY":
        if (birthdayInWindow(p.birthday, now, c.params.birthdayWindowDays ?? 0))
          out.push({ campaign: c, reason: "Birthday" });
        break;
      case "SECOND_ORDER": {
        const after = c.params.secondOrderAfterDays ?? 7;
        if (p.totalOrders === 1 && gap !== null && gap >= after)
          out.push({ campaign: c, reason: `Single order ${gap} days ago, no second order` });
        break;
      }
      case "INACTIVE_15":
        if (stage === "AT_RISK") out.push({ campaign: c, reason: inactivityReason(gap, ratio, p) });
        break;
      case "WINBACK_30":
        if (stage === "DORMANT") out.push({ campaign: c, reason: inactivityReason(gap, ratio, p) });
        break;
      case "LOST_60":
        if (stage === "LOST") out.push({ campaign: c, reason: inactivityReason(gap, ratio, p) });
        break;
      case "VIP_PROTECTION":
        if (p.vipFlag && (stage === "AT_RISK" || stage === "DORMANT"))
          out.push({ campaign: c, reason: `VIP inactive (${gap} days)` });
        break;
      default:
        // Event / manual campaigns (first-order, thank-you, new offer,
        // selected-customer) are enqueued by their own producers, not by
        // the daily rule scan.
        break;
    }
  }
  return out;
}

function inactivityReason(gap: number | null, ratio: number | null, p: CustomerProfile): string {
  if (ratio !== null && p.medianIntervalDays)
    return `${gap} days since order vs ${p.medianIntervalDays}-day normal cycle`;
  return `${gap} days since last order`;
}
