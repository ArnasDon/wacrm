/**
 * Pure campaign-metrics math — no Supabase, no fetch, so it's cheap to
 * test exhaustively. Callers (the /campaigns page loader) fetch the
 * raw rows and hand them here; this module only does arithmetic.
 */

export interface DailyMetricRow {
  date: string
  spend: number
  impressions: number
  clicks: number
  /** Meta's own "conversations started" count. Absent for manual rows. */
  messagingStarted: number | null
}

export interface AggregatedMetrics {
  spend: number
  impressions: number
  clicks: number
  /** Null when every row in range has no value, not just zero — zero
   *  is a real "Meta reported 0", null means "we don't know". */
  messagingStarted: number | null
}

/**
 * Sum a campaign's daily rows over whatever range the caller already
 * filtered to. Kept separate from the DB query so the date-range
 * logic (see src/lib/dashboard/date-utils.ts) and this arithmetic can
 * be tested independently.
 */
export function sumDailyMetrics(rows: DailyMetricRow[]): AggregatedMetrics {
  let spend = 0
  let impressions = 0
  let clicks = 0
  let messagingStarted: number | null = null

  for (const row of rows) {
    spend += Number(row.spend) || 0
    impressions += Number(row.impressions) || 0
    clicks += Number(row.clicks) || 0
    if (row.messagingStarted !== null) {
      messagingStarted = (messagingStarted ?? 0) + row.messagingStarted
    }
  }

  return { spend, impressions, clicks, messagingStarted }
}

/**
 * Cost per unit (per lead, per conversation started, ...). Null — not
 * Infinity or 0 — when there's nothing to divide by, so the UI can
 * render "n/d" instead of a misleading number. A campaign with real
 * spend but zero leads is exactly the case worth flagging, not hiding
 * behind a 0.
 */
export function costPerUnit(spend: number, count: number): number | null {
  if (!Number.isFinite(spend) || !Number.isFinite(count) || count <= 0) {
    return null
  }
  return spend / count
}
