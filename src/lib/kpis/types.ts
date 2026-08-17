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
}
