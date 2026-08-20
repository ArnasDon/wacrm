// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  openDealsValue: number
  openDealsCount: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

// ------------------------------------------------------------
// Rimula funnel / attribution analytics (§13, Phase 7).
// ------------------------------------------------------------

export type FunnelStageKey =
  | 'reach'
  | 'join'
  | 'engage'
  | 'productInterest'
  | 'lead'
  | 'baContact'
  | 'trial'
  | 'purchase'
  | 'repeat'

export interface FunnelStage {
  key: FunnelStageKey
  /**
   * Real count from the DB, or `null` when the metric genuinely isn't
   * obtainable from the current WhatsApp integration/schema (§13 — a
   * `null` value renders "Unavailable", never a guessed number).
   */
  value: number | null
}

export interface FunnelMetrics {
  stages: FunnelStage[]
}

/** One row of §13's campaign analytics — one campaign's whole funnel. */
export interface CampaignAnalytics {
  campaignId: string
  campaignName: string
  reach: number
  engagement: number
  leads: number
  trials: number
  conversions: number
  /** `accounts.default_currency`-denominated; null when no real cost data exists (§13). */
  cost: number | null
  costPerLead: number | null
  costPerTrial: number | null
  costPerConversion: number | null
}

export interface ProductInteractionBreakdown {
  viewed: number
  clicked: number
  enquiry: number
  interest: number
  trial_request: number
  lead: number
  conversion: number
}

export interface ProductAnalytics {
  productId: string
  productName: string
  interactions: ProductInteractionBreakdown
  customerRequests: number
  trials: number
  /** Trials for this product that reached `CONVERTED` — the only
   *  product-attributable conversion signal, since `deals` (Lead)
   *  carries no direct `product_id` (§9.0 — product is reachable via
   *  `campaign_id -> campaigns.product_id`, not a duplicate column). */
  conversions: number
}
