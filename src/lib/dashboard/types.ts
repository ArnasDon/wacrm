// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

import type { CurrencyTotal } from '@/lib/currency'

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  /** Open-deal value, kept separate per currency — never summed across
   *  currencies (a $100 deal and a Q100 deal are not $200). */
  openDealsByCurrency: CurrencyTotal[]
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
  /** Distinct contacts with an open deal in this stage — a contact
   *  with two open deals here still counts once. */
  peopleCount: number
  /** Open-deal totals for this stage, kept separate per currency. */
  totalsByCurrency: CurrencyTotal[]
}

/** One pipeline's open-deal breakdown, stage by stage. */
export interface PipelineSummary {
  id: string
  name: string
  stages: PipelineStageSlice[]
  /** Distinct contacts with an open deal anywhere in this pipeline. */
  peopleCount: number
  totalsByCurrency: CurrencyTotal[]
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

/**
 * How long a human agent takes to pick up a chat the AI handed off —
 * distinct from `ResponseTimeSummary`, which measures first-response
 * time for EVERY inbound message (AI replies included). Computed over
 * the last 30 days of `conversations.ai_handoff_at` (migration 070).
 */
export interface HandoffWaitSummary {
  /** Average minutes from handoff to the first human (non-AI) reply.
   *  Null when there are no attended handoffs in the window. */
  avgMinutes: number | null
  /** Handoffs in the window that a human has since replied to. */
  samples: number
  /** Handoffs in the window still waiting on a human reply. */
  pendingCount: number
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
