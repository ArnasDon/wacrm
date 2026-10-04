import type { ContactPolicy, CustomerProfile, PastSend } from "./types";

export interface PolicyVerdict {
  allowed: boolean;
  reason?: string;
}

const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** Local hour for a fixed UTC offset (Saudi Arabia has no DST). */
export function localHour(now: Date, utcOffsetHours: number): number {
  return (now.getUTCHours() + utcOffsetHours + 24) % 24;
}

export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Gate every marketing send (PRD §55, §74, §82-83). Order matters only for
 * the reported reason; any failing check blocks. Transactional / service
 * messages do NOT go through this gate.
 */
export function checkContactPolicy(
  p: CustomerProfile,
  policy: ContactPolicy,
  now: Date,
  history: PastSend[],
  opts: { isPromo: boolean; lastOrderAt?: Date | null; alreadyReceivedCampaign?: boolean },
): PolicyVerdict {
  if (!p.marketingOptIn) return { allowed: false, reason: "opted_out" };
  if (p.activeComplaint) return { allowed: false, reason: "active_complaint" };
  if (opts.alreadyReceivedCampaign) return { allowed: false, reason: "already_received_campaign" };

  if (opts.lastOrderAt) {
    const hrs = (now.getTime() - opts.lastOrderAt.getTime()) / MS_HOUR;
    if (hrs >= 0 && hrs < policy.suppressAfterOrderHours)
      return { allowed: false, reason: "ordered_recently" };
  }

  const inWindow = (days: number) =>
    history.filter((h) => now.getTime() - h.sentAt.getTime() < days * MS_DAY);

  if (inWindow(policy.marketingWindowDays).length >= policy.maxMarketingPerWindow)
    return { allowed: false, reason: "marketing_frequency_cap" };

  if (
    opts.isPromo &&
    inWindow(policy.promoWindowDays).filter((h) => h.isPromo).length >= policy.maxPromoPerWindow
  )
    return { allowed: false, reason: "promo_frequency_cap" };

  return { allowed: true };
}

/** True when sending right now would land in quiet hours. */
export function isQuietNow(policy: ContactPolicy, now: Date): boolean {
  return inQuietHours(localHour(now, policy.utcOffsetHours), policy.quietHoursStart, policy.quietHoursEnd);
}
