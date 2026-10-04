import { DEFAULT_POLICY, type CampaignConfig, type CampaignType, type ContactPolicy, type PriorityClass } from "./types";

/** Default PRD §56 priority class for each campaign type (overridable via rule_params.priority_class). */
export const PRIORITY_CLASS_BY_TYPE: Record<CampaignType, PriorityClass> = {
  FIRST_ORDER_THANK_YOU: "ORDER_COMMUNICATION",
  THANK_YOU: "ORDER_COMMUNICATION",
  SECOND_ORDER: "PERSONALIZED_OFFER",
  INACTIVE_15: "WINBACK",
  WINBACK_30: "WINBACK",
  LOST_60: "WINBACK",
  BIRTHDAY: "BIRTHDAY",
  VIP_PROTECTION: "VIP",
  NEW_OFFER: "GENERAL_PROMOTION",
  SELECTED_CUSTOMER_OFFER: "PERSONALIZED_OFFER",
};

/** Campaigns that can run on the order table alone (no birthday / item data needed). */
export const DEFAULT_CAMPAIGN_ROWS = [
  { campaign_code: "INACTIVE_15", name: "15-Day Inactive", campaign_type: "INACTIVE_15", rule_params: { inactiveDays: 15 }, priority: 50 },
  { campaign_code: "WINBACK_30", name: "30-Day Win-back", campaign_type: "WINBACK_30", rule_params: { winbackDays: 30 }, priority: 50 },
  { campaign_code: "LOST_60", name: "60-Day Lost Customer", campaign_type: "LOST_60", rule_params: { lostDays: 60 }, priority: 60 },
  { campaign_code: "SECOND_ORDER", name: "Second Order", campaign_type: "SECOND_ORDER", rule_params: { secondOrderAfterDays: 7 }, priority: 40 },
  { campaign_code: "VIP_PROTECTION", name: "VIP Protection", campaign_type: "VIP_PROTECTION", rule_params: {}, priority: 10 },
] as const;

export interface CampaignRow {
  id: string;
  campaign_code: string;
  name: string;
  campaign_type: CampaignType;
  rule_params: Record<string, unknown> | null;
  offer_id: string | null;
  active: boolean;
}

export function campaignFromRow(r: CampaignRow): CampaignConfig {
  const params = (r.rule_params ?? {}) as CampaignConfig["params"] & { priority_class?: PriorityClass };
  return {
    id: r.id,
    code: r.campaign_code,
    name: r.name,
    type: r.campaign_type,
    priorityClass: params.priority_class ?? PRIORITY_CLASS_BY_TYPE[r.campaign_type] ?? "GENERAL_PROMOTION",
    active: r.active,
    offerId: r.offer_id,
    params,
  };
}

export interface PolicyRow {
  max_promo_per_window: number;
  promo_window_days: number;
  max_marketing_per_window: number;
  marketing_window_days: number;
  suppress_after_order_hours: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  priority_order: string[];
}

export function policyFromRow(r: PolicyRow | null | undefined): ContactPolicy {
  if (!r) return DEFAULT_POLICY;
  return {
    maxPromoPerWindow: r.max_promo_per_window,
    promoWindowDays: r.promo_window_days,
    maxMarketingPerWindow: r.max_marketing_per_window,
    marketingWindowDays: r.marketing_window_days,
    suppressAfterOrderHours: r.suppress_after_order_hours,
    quietHoursStart: r.quiet_hours_start,
    quietHoursEnd: r.quiet_hours_end,
    utcOffsetHours: DEFAULT_POLICY.utcOffsetHours,
    priorityOrder: r.priority_order as PriorityClass[],
  };
}
