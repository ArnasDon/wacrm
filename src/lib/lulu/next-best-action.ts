import { checkContactPolicy } from "./contact-policy";
import { matchingCampaigns } from "./lifecycle";
import type {
  CampaignConfig,
  ContactPolicy,
  CustomerProfile,
  DecisionResult,
  PastSend,
} from "./types";

/** Idempotency key, e.g. WINBACK30_20260924_CUSTOMER12345 (PRD §73). */
export function idempotencyKey(campaignCode: string, customerId: string, now: Date): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `${campaignCode.replace(/_/g, "")}_${ymd}_${customerId}`;
}

export interface DecideInput {
  profile: CustomerProfile;
  campaigns: CampaignConfig[];
  policy: ContactPolicy;
  history: PastSend[];
  now: Date;
  lastOrderAt?: Date | null;
  /** Campaign codes this customer already received (per-campaign dedupe). */
  receivedCampaignCodes?: Set<string>;
  isPromo?: (c: CampaignConfig) => boolean;
}

/**
 * Pick the single best action for one customer (PRD §67):
 * 1. find every campaign whose trigger matches,
 * 2. drop those blocked by the contact policy,
 * 3. keep the highest configured priority (lowest index in priorityOrder);
 *    ties break on campaign code for determinism.
 * Pure function — safe to run in dry-run mode over the whole base.
 */
export function decideNextBestAction(input: DecideInput): DecisionResult {
  const { profile, campaigns, policy, history, now } = input;
  const skipped: DecisionResult["skipped"] = [];
  const isPromo = input.isPromo ?? ((c) => c.offerId != null || c.priorityClass !== "ORDER_COMMUNICATION");

  const eligible = [];
  for (const cand of matchingCampaigns(profile, campaigns, now)) {
    const verdict = checkContactPolicy(profile, policy, now, history, {
      isPromo: isPromo(cand.campaign),
      lastOrderAt: input.lastOrderAt,
      alreadyReceivedCampaign: input.receivedCampaignCodes?.has(cand.campaign.code),
    });
    if (!verdict.allowed) {
      skipped.push({ campaignCode: cand.campaign.code, reason: verdict.reason! });
      continue;
    }
    eligible.push(cand);
  }

  if (eligible.length === 0) return { action: null, skipped };

  const rank = (c: CampaignConfig) => {
    const i = policy.priorityOrder.indexOf(c.priorityClass);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  eligible.sort((a, b) => rank(a.campaign) - rank(b.campaign) || a.campaign.code.localeCompare(b.campaign.code));

  const [best, ...losers] = eligible;
  for (const l of losers) skipped.push({ campaignCode: l.campaign.code, reason: "lower_priority" });

  return {
    action: {
      customerId: profile.customerId,
      campaignId: best.campaign.id,
      campaignCode: best.campaign.code,
      offerId: best.campaign.offerId ?? null,
      reason: best.reason,
      language: profile.language,
      priorityClass: best.campaign.priorityClass,
      idempotencyKey: idempotencyKey(best.campaign.code, profile.customerId, now),
    },
    skipped,
  };
}
