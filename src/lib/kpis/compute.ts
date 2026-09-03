// ============================================================
// Pure calculations for the KPIs page — no I/O, fully unit-testable
// in isolation. Mirrors the "pure function + thin query wrapper"
// split already used elsewhere (move-deal.ts / business-actions.ts).
// ============================================================

import {
  bucketKey,
  bucketRangeKeys,
  type BucketGranularity,
} from '@/lib/dashboard/date-utils'
import type {
  CsatRow,
  CsatSummary,
  DateWindow,
  LeadRow,
  SeriesPoint,
  TemperatureDistribution,
  WonDealRow,
} from './types'

/**
 * "Tasa de conversión o cierre" — the article's own formula: total
 * sales ÷ total leads obtained, as a percentage. `null` (never a
 * fake 0%) when there were no leads to convert — an empty
 * denominator has no rate, not a zero one.
 */
export function conversionRate(wonCount: number, leadsCount: number): number | null {
  if (leadsCount === 0) return null
  return (wonCount / leadsCount) * 100
}

/**
 * "Costo de Adquisición del Cliente" — total investment ÷ customers
 * acquired. `null` when no customers were acquired in the period
 * (division by zero has no meaningful answer, and showing "$0" would
 * misleadingly suggest acquisition was free).
 */
export function cac(spend: number, customersAcquired: number): number | null {
  if (customersAcquired <= 0) return null
  return spend / customersAcquired
}

export interface Delta {
  /** Positive / negative / zero — feeds MetricCard's arrow + color. */
  sign: number
  /** Pre-formatted delta text, e.g. "+12% vs periodo anterior". */
  label: string
}

/**
 * Period-over-period delta as a MetricCard-ready `{sign, label}`.
 * `unit` is appended to the raw values in the label (e.g. "" for a
 * plain count, "%" for a rate) — kept as a suffix rather than part of
 * `formatter` so the sign/percentage math stays unit-agnostic.
 */
export function periodDelta(
  current: number,
  previous: number,
  suffixLabel: string,
  opts: { unit?: string; decimals?: number } = {},
): Delta {
  const { unit = '', decimals = 0 } = opts
  const diff = current - previous
  const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}${unit}`
  return { sign, label: `${fmt(diff)} ${suffixLabel}` }
}

/** Counts contacts whose `lead_temperature` signals real buying
 *  interest — "leads calificados" per this CRM's own qualification
 *  signal (the same field the AI's autonomous classification writes
 *  to). A snapshot of CURRENT temperature, not a historical record —
 *  there's no temperature-change log in this schema — so this answers
 *  "of the leads generated in this window, how many currently show
 *  warm/hot interest," which drifts slightly from "were qualified
 *  the moment they arrived" but is the best signal available. */
export function countQualifiedLeads(leads: LeadRow[]): number {
  return leads.filter((l) => l.lead_temperature === 'warm' || l.lead_temperature === 'hot').length
}

/** Post-sale satisfaction over a set of CSAT survey rows. `delivered`
 *  counts surveys that reached the customer (sent or answered);
 *  `avgPercent` normalises each score by its own scale so a 1–3 and a
 *  1–5 account read on the same 0–100 axis. Everything is `null` rather
 *  than a fake 0 when there's nothing to average. */
export function csatSummary(rows: CsatRow[]): CsatSummary {
  let delivered = 0
  let responded = 0
  let pctSum = 0
  for (const r of rows) {
    if (r.status === 'sent' || r.status === 'responded') delivered += 1
    if (r.status === 'responded' && r.score != null && r.scale > 0) {
      responded += 1
      pctSum += (r.score / r.scale) * 100
    }
  }
  return {
    delivered,
    responded,
    avgPercent: responded === 0 ? null : pctSum / responded,
    responseRate: delivered === 0 ? null : (responded / delivered) * 100,
  }
}

export function temperatureDistribution(leads: LeadRow[]): TemperatureDistribution {
  const out: TemperatureDistribution = { cold: 0, warm: 0, hot: 0, unclassified: 0 }
  for (const l of leads) {
    if (l.lead_temperature === 'cold') out.cold += 1
    else if (l.lead_temperature === 'warm') out.warm += 1
    else if (l.lead_temperature === 'hot') out.hot += 1
    else out.unclassified += 1
  }
  return out
}

/** The instant a deal counts as "won" for KPI purposes — `won_at`
 *  when present (every deal won after migration 064), falling back to
 *  `updated_at` only for a legacy row that somehow missed the
 *  backfill. */
function wonAt(deal: WonDealRow): string {
  return deal.won_at ?? deal.updated_at
}

/** Buckets `rows` (by `created_at`) or won deals (by `wonAt`) into
 *  zero-filled chronological series across `window` at `granularity`.
 *  Shared by every time-series chart on the KPIs page so they all
 *  bucket identically. */
export function bucketSeries(
  rows: { timestamp: string }[],
  window: DateWindow,
  granularity: BucketGranularity,
): SeriesPoint[] {
  const keys = bucketRangeKeys(window.start, window.end, granularity)
  const counts = new Map<string, number>()
  for (const k of keys) counts.set(k, 0)
  for (const row of rows) {
    const key = bucketKey(row.timestamp, granularity)
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return keys.map((key) => ({ key, value: counts.get(key) ?? 0 }))
}

export function leadsSeries(leads: LeadRow[], window: DateWindow, granularity: BucketGranularity): SeriesPoint[] {
  return bucketSeries(
    leads.map((l) => ({ timestamp: l.created_at })),
    window,
    granularity,
  )
}

export function qualifiedLeadsSeries(
  leads: LeadRow[],
  window: DateWindow,
  granularity: BucketGranularity,
): SeriesPoint[] {
  return bucketSeries(
    leads.filter((l) => l.lead_temperature === 'warm' || l.lead_temperature === 'hot').map((l) => ({ timestamp: l.created_at })),
    window,
    granularity,
  )
}

export function wonDealsSeries(
  wonDeals: WonDealRow[],
  window: DateWindow,
  granularity: BucketGranularity,
): SeriesPoint[] {
  return bucketSeries(
    wonDeals.map((d) => ({ timestamp: wonAt(d) })),
    window,
    granularity,
  )
}

/** "Tasa de conversión" as a time series — per bucket, (won that
 *  bucket ÷ leads generated that bucket) × 100. A bucket with zero
 *  leads has no rate (`value: 0` in the series so the chart still
 *  draws a continuous line, but callers wanting to distinguish
 *  "0% conversion" from "no leads that period" should cross-reference
 *  the leads series for the same bucket). */
export function conversionRateSeries(
  leads: LeadRow[],
  wonDeals: WonDealRow[],
  window: DateWindow,
  granularity: BucketGranularity,
): SeriesPoint[] {
  const leadPoints = leadsSeries(leads, window, granularity)
  const wonPoints = wonDealsSeries(wonDeals, window, granularity)
  const wonByKey = new Map(wonPoints.map((p) => [p.key, p.value]))
  return leadPoints.map((p) => ({
    key: p.key,
    value: p.value === 0 ? 0 : ((wonByKey.get(p.key) ?? 0) / p.value) * 100,
  }))
}
