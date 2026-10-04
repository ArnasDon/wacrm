/**
 * LuLu engagement engine — shared types.
 * Pure data shapes; no I/O. Mirrors migration 043 (lulu_* tables).
 */

export type LifecycleStage =
  | "NEW"
  | "FIRST_ORDER"
  | "ACTIVE"
  | "AT_RISK"
  | "DORMANT"
  | "LOST";

export type CampaignType =
  | "FIRST_ORDER_THANK_YOU"
  | "THANK_YOU"
  | "SECOND_ORDER"
  | "INACTIVE_15"
  | "WINBACK_30"
  | "LOST_60"
  | "BIRTHDAY"
  | "VIP_PROTECTION"
  | "NEW_OFFER"
  | "SELECTED_CUSTOMER_OFFER";

/** PRD §56 priority classes. Order is configurable via lulu_contact_policy. */
export type PriorityClass =
  | "SERVICE_RECOVERY"
  | "BIRTHDAY"
  | "ORDER_COMMUNICATION"
  | "VIP"
  | "WINBACK"
  | "PERSONALIZED_OFFER"
  | "GENERAL_PROMOTION";

export interface CustomerProfile {
  customerId: string;
  mobile: string;
  name?: string | null;
  language: string;
  birthday?: string | null; // YYYY-MM-DD
  lastOrderDate?: string | null; // YYYY-MM-DD
  totalOrders: number;
  totalSales: number;
  medianIntervalDays?: number | null;
  vipFlag: boolean;
  marketingOptIn: boolean;
  activeComplaint: boolean;
  preferredStore?: string | null;
}

export interface CampaignConfig {
  id: string;
  code: string;
  type: CampaignType;
  priorityClass: PriorityClass;
  active: boolean;
  offerId?: string | null;
  /** Configurable thresholds (PRD §100: no code change for business rules). */
  params: {
    inactiveDays?: number; // fixed-day fallback, default 15
    winbackDays?: number; // default 30
    lostDays?: number; // default 60
    secondOrderAfterDays?: number; // default 7
    birthdayWindowDays?: number; // default 0 (today only)
  };
}

export interface ContactPolicy {
  maxPromoPerWindow: number;
  promoWindowDays: number;
  maxMarketingPerWindow: number;
  marketingWindowDays: number;
  suppressAfterOrderHours: number;
  quietHoursStart: number; // local hour, inclusive
  quietHoursEnd: number; // local hour, exclusive
  utcOffsetHours: number; // Asia/Riyadh = 3
  priorityOrder: PriorityClass[];
}

export interface PastSend {
  sentAt: Date;
  isPromo: boolean;
}

export interface CandidateAction {
  campaign: CampaignConfig;
  reason: string;
}

export interface NextBestAction {
  customerId: string;
  campaignId: string;
  campaignCode: string;
  offerId?: string | null;
  reason: string;
  language: string;
  priorityClass: PriorityClass;
  idempotencyKey: string;
}

export interface DecisionResult {
  action: NextBestAction | null;
  /** Why nothing was sent (or what lost the priority contest). Fuels dry-run reports. */
  skipped: { campaignCode: string; reason: string }[];
}

export const DEFAULT_POLICY: ContactPolicy = {
  maxPromoPerWindow: 3,
  promoWindowDays: 7,
  maxMarketingPerWindow: 5,
  marketingWindowDays: 14,
  suppressAfterOrderHours: 24,
  quietHoursStart: 22,
  quietHoursEnd: 9,
  utcOffsetHours: 3,
  priorityOrder: [
    "SERVICE_RECOVERY",
    "BIRTHDAY",
    "ORDER_COMMUNICATION",
    "VIP",
    "WINBACK",
    "PERSONALIZED_OFFER",
    "GENERAL_PROMOTION",
  ],
};
