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

/** One post-sale CSAT survey row (migration 102), as pulled for the
 *  satisfaction KPI. */
export interface CsatRow {
  created_at: string
  status: 'pending' | 'sent' | 'responded' | 'failed' | 'skipped'
  score: number | null
  /** The 1..scale the score is out of (3 or 5). */
  scale: number
}

export interface CsatSummary {
  /** Surveys that actually reached the customer (sent + responded). */
  delivered: number
  /** Surveys the customer answered. */
  responded: number
  /** Mean of `score / scale` across answered surveys, 0–100. `null`
   *  when nothing has been answered yet — an empty set has no average,
   *  not a zero one. Normalising by scale keeps a 3-button and a
   *  5-button account comparable. */
  avgPercent: number | null
  /** `responded / delivered` as a percentage, or `null` when nothing
   *  was delivered. */
  responseRate: number | null
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
  csat: CsatSummary
}
