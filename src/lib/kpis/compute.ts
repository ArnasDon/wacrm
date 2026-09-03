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
import type { DateWindow, LeadRow, SeriesPoint, TemperatureDistribution, WonDealRow } from './types'

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

// ============================================================
// Trial / operational metrics (see TrialMetrics in ./types). Pure —
// callers in queries.ts do the fetching and hand raw rows in here.
// ============================================================

/** First inbound + first outbound instant per conversation, from a
 *  flat message list. "Outbound" is agent or bot. Missing side stays
 *  null (a conversation with only inbound, or only outbound). */
export function conversationFirstTimes(
  rows: { conversation_id: string; sender_type: string; created_at: string }[],
): Map<string, { firstInMs: number | null; firstOutMs: number | null }> {
  const out = new Map<string, { firstInMs: number | null; firstOutMs: number | null }>()
  for (const r of rows) {
    const ts = new Date(r.created_at).getTime()
    if (!Number.isFinite(ts)) continue
    const cur = out.get(r.conversation_id) ?? { firstInMs: null, firstOutMs: null }
    if (r.sender_type === 'customer') {
      if (cur.firstInMs === null || ts < cur.firstInMs) cur.firstInMs = ts
    } else if (r.sender_type === 'agent' || r.sender_type === 'bot') {
      if (cur.firstOutMs === null || ts < cur.firstOutMs) cur.firstOutMs = ts
    }
    out.set(r.conversation_id, cur)
  }
  return out
}

/** Median minutes between first inbound and first outbound, over
 *  conversations that were actually answered (outbound strictly after
 *  inbound). `null` when none qualify. */
export function medianFirstResponseMinutes(
  firstTimes: Map<string, { firstInMs: number | null; firstOutMs: number | null }>,
): number | null {
  const gaps: number[] = []
  for (const { firstInMs, firstOutMs } of firstTimes.values()) {
    if (firstInMs === null || firstOutMs === null) continue
    if (firstOutMs <= firstInMs) continue
    gaps.push((firstOutMs - firstInMs) / 60_000)
  }
  if (gaps.length === 0) return null
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid]
}

/** How many conversations got an agent/bot reply after an inbound. */
export function answeredConversationCount(
  firstTimes: Map<string, { firstInMs: number | null; firstOutMs: number | null }>,
): number {
  let n = 0
  for (const { firstInMs, firstOutMs } of firstTimes.values()) {
    if (firstInMs !== null && firstOutMs !== null && firstOutMs > firstInMs) n += 1
  }
  return n
}

/** Distinct conversations where a customer message landed *after* one
 *  of that conversation's follow-up nudges — i.e. the nudge revived it. */
export function recoveredConversationCount(
  followups: { conversation_id: string; sent_at: string }[],
  customerMessages: { conversation_id: string; created_at: string }[],
): number {
  // Earliest nudge per conversation is the bar to clear.
  const earliestNudge = new Map<string, number>()
  for (const f of followups) {
    const ts = new Date(f.sent_at).getTime()
    if (!Number.isFinite(ts)) continue
    const cur = earliestNudge.get(f.conversation_id)
    if (cur === undefined || ts < cur) earliestNudge.set(f.conversation_id, ts)
  }
  const recovered = new Set<string>()
  for (const m of customerMessages) {
    const nudgeTs = earliestNudge.get(m.conversation_id)
    if (nudgeTs === undefined) continue
    if (new Date(m.created_at).getTime() > nudgeTs) recovered.add(m.conversation_id)
  }
  return recovered.size
}

/** Handoffs whose contact has a deal that advanced or was won *after*
 *  the handoff instant — a proxy for "the derivation led somewhere". */
export function handoffsAdvancedCount(
  handoffs: { contact_id: string | null; ai_handoff_at: string }[],
  deals: { contact_id: string; status: string; won_at: string | null; updated_at: string }[],
): number {
  const dealsByContact = new Map<string, typeof deals>()
  for (const d of deals) {
    const arr = dealsByContact.get(d.contact_id) ?? []
    arr.push(d)
    dealsByContact.set(d.contact_id, arr)
  }
  let n = 0
  for (const h of handoffs) {
    if (!h.contact_id) continue
    const handoffTs = new Date(h.ai_handoff_at).getTime()
    const contactDeals = dealsByContact.get(h.contact_id) ?? []
    const advanced = contactDeals.some((d) => {
      if (d.status === 'won') return true
      const wonTs = d.won_at ? new Date(d.won_at).getTime() : null
      if (wonTs !== null && wonTs > handoffTs) return true
      return new Date(d.updated_at).getTime() > handoffTs
    })
    if (advanced) n += 1
  }
  return n
}

/** Share (0–100) of `leadIds` that appear in `contactIdsWithValues`.
 *  `null` when there are no leads to measure. */
export function briefCompletionPercent(
  leadIds: string[],
  contactIdsWithValues: Set<string>,
): number | null {
  if (leadIds.length === 0) return null
  let filled = 0
  for (const id of leadIds) if (contactIdsWithValues.has(id)) filled += 1
  return (filled / leadIds.length) * 100
}
