// ============================================================
// Shared types for the KPIs page (src/app/(dashboard)/kpis) — the 4
// sales KPIs from the article Angel linked (leads generados, leads
// calificados, tasa de conversión/cierre, costo de adquisición del
// cliente), plus the chart-data shapes they feed.
// ============================================================

import type { BucketGranularity } from '@/lib/dashboard/date-utils'

export interface DateWindow {
  /** Inclusive. */
  start: Date
  /** Inclusive (compared as `< end + 1 day` in queries). */
  end: Date
}

/** One bucketed point in a time-series chart. */
export interface SeriesPoint {
  /** Raw bucket key (see date-utils's bucketKey) — the chart x-axis
   *  renders `formatBucketLabel(key, granularity)` instead. */
  key: string
  value: number
}

/** A single contact row, as pulled for the leads-generated /
 *  leads-calificados KPIs and their time series. */
export interface LeadRow {
  id: string
  created_at: string
  lead_temperature: 'cold' | 'warm' | 'hot' | null
}

/** A single won-deal row, as pulled for the conversion-rate /
 *  funnel / CAC KPIs. `won_at` is null only for legacy rows that
 *  predate migration 064 and were never backfilled (shouldn't
 *  happen in practice — the migration backfills every existing won
 *  deal — but queries defensively fall back to `updated_at`). */
export interface WonDealRow {
  id: string
  won_at: string | null
  updated_at: string
  value: number | null
  currency: string | null
}

export interface TemperatureDistribution {
  cold: number
  warm: number
  hot: number
  /** Contacts in the window with no temperature classified yet. */
  unclassified: number
}

/** One saved CAC input — a real spend figure an admin entered for a
 *  period they were viewing (see `kpi_period_spend`, migration 065). */
export interface SpendEntry {
  id: string
  period_start: string
  period_end: string
  amount: number
  currency: string
}

/** One contact who wrote in during the window, shaped for the
 *  "Contacts" export sheet — name/phone/channel/stage the KPIs page
 *  itself never needs on screen, so this is fetched lazily on export
 *  click rather than folded into `KpiDataset`. */
export interface ContactExportRow {
  id: string
  name: string
  phone: string | null
  channel: 'whatsapp' | 'instagram' | 'facebook'
  createdAt: string
  /** Every `contact_notes` row for this contact, oldest first, joined
   *  with " | " — there's no dedicated "reason for inquiry" field, so
   *  this is the closest real data to it (see contact-sidebar.tsx's
   *  notes section, the same table). */
  notes: string
  /** Name of the stage of this contact's most recent deal, or null if
   *  they have none yet. */
  stage: string | null
}

/** Operational "trial" metrics — the ones the Plan Pro proposal's
 *  "Impacto esperado" page lists that the sales KPIs above don't cover.
 *  All derived from `messages` / `ai_followup_log` / `conversations`,
 *  no new schema. Measured over conversations/nudges/handoffs that were
 *  active *within* the window (not "opened in"), which keeps every
 *  query bounded by the window size. */
export interface TrialMetrics {
  /** Conversations with at least one message in the window. */
  conversationsActive: number
  /** …of those, how many got an agent/bot reply in the window. */
  conversationsAnswered: number
  /** Median minutes from a conversation's first inbound to its first
   *  outbound, over answered conversations. `null` when none. */
  medianFirstResponseMin: number | null
  /** Same for the previous window — feeds the delta. */
  prevMedianFirstResponseMin: number | null
  /** Follow-up nudges the sweeper actually sent (error-free) in the window. */
  followupsSent: number
  prevFollowupsSent: number
  /** Distinct conversations where the customer replied after a nudge. */
  opportunitiesRecovered: number
  /** Conversations handed to a human in the window. */
  handoffs: number
  /** …of those, how many where the contact's deal later advanced/won. */
  handoffsAdvanced: number
  /** Share (0–100) of the window's leads that have at least one
   *  captured custom-field value ("brief started"). `null` with no leads. */
  briefCompletionPct: number | null
}

/** Everything the KPIs page needs for one render, bundled so the
 *  page component and the Excel exporter both consume the exact same
 *  shape. */
export interface KpiDataset {
  granularity: BucketGranularity
  window: DateWindow
  previousWindow: DateWindow
  leads: LeadRow[]
  previousLeadsCount: number
  wonDeals: WonDealRow[]
  previousWonCount: number
  temperature: TemperatureDistribution
  spendHistory: SpendEntry[]
  currentPeriodSpend: SpendEntry | null
  trial: TrialMetrics
}
