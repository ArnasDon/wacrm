// Centralised date helpers for the dashboard so every chart / card
// agrees on what "today", "day boundary", and "day of week" mean.
// All boundaries are computed in the user's LOCAL timezone — which is
// what a business user intuitively expects when they say "today".

export function startOfLocalDay(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function daysAgoStart(days: number): Date {
  const out = startOfLocalDay()
  out.setDate(out.getDate() - days)
  return out
}

/** Date-only key (YYYY-MM-DD) for bucketing rows by local calendar day. */
export function localDayKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Inclusive list of local-day keys spanning the last `n` days, in
 * chronological order. Useful for seeding chart buckets so days with
 * zero activity still render a 0-point in the line.
 */
export function lastNDayKeys(n: number): string[] {
  const keys: string[] = []
  const start = daysAgoStart(n - 1)
  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    keys.push(localDayKey(d))
  }
  return keys
}

/**
 * ISO day-of-week where 0 = Monday … 6 = Sunday. JavaScript's native
 * getDay() uses 0 = Sunday which is awkward for most business charts.
 */
export function mondayIndex(d: Date): number {
  const jsDow = d.getDay() // 0..6 with Sunday=0
  return (jsDow + 6) % 7
}

export const DOW_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

// ============================================================
// Multi-granularity bucketing for the KPIs page's time-series charts
// (src/lib/kpis/queries.ts). The dashboard's own charts only ever
// bucket by single day (`lastNDayKeys`/`localDayKey` above); a KPI
// view spanning a year would render 365 unreadable daily points, so
// these add week/month bucketing on top of the same "local calendar
// day" philosophy.
// ============================================================

export type BucketGranularity = 'day' | 'week' | 'month'

/** Picks a sensible bucket size for a given range length so a chart
 *  never renders more than ~30-ish points: daily under a month,
 *  weekly up to ~4 months, monthly beyond that. */
export function granularityForRangeDays(days: number): BucketGranularity {
  if (days <= 31) return 'day'
  if (days <= 120) return 'week'
  return 'month'
}

/** The Monday (local) that starts the ISO week containing `d`. */
function startOfWeek(d: Date): Date {
  const out = startOfLocalDay(d)
  out.setDate(out.getDate() - mondayIndex(out))
  return out
}

/** Bucket key for `d` at the given granularity: a local day key
 *  (`day`), that week's Monday as a local day key (`week`), or
 *  `YYYY-MM` (`month`). Weeks and months both key on their *start*,
 *  so `bucketRangeKeys` below can walk forward by fixed steps. */
export function bucketKey(d: Date | string, granularity: BucketGranularity): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (granularity === 'day') return localDayKey(date)
  if (granularity === 'week') return localDayKey(startOfWeek(date))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Inclusive, chronological list of bucket keys spanning
 *  [`start`, `end`] at the given granularity — seeds chart buckets so
 *  empty periods still render a 0-point instead of a gap. */
export function bucketRangeKeys(start: Date, end: Date, granularity: BucketGranularity): string[] {
  const keys: string[] = []
  if (granularity === 'month') {
    let y = start.getFullYear()
    let m = start.getMonth()
    const endY = end.getFullYear()
    const endM = end.getMonth()
    while (y < endY || (y === endY && m <= endM)) {
      keys.push(`${y}-${String(m + 1).padStart(2, '0')}`)
      m += 1
      if (m > 11) {
        m = 0
        y += 1
      }
    }
    return keys
  }

  const step = granularity === 'week' ? 7 : 1
  let cursor = granularity === 'week' ? startOfWeek(start) : startOfLocalDay(start)
  const endDay = startOfLocalDay(end)
  while (cursor <= endDay) {
    keys.push(localDayKey(cursor))
    cursor = new Date(cursor)
    cursor.setDate(cursor.getDate() + step)
  }
  return keys
}

/** Fixed to `en-US` rather than the ambient/OS locale (`undefined`) —
 *  these are compact chart-axis/export labels, not UI copy routed
 *  through next-intl, so they must render identically ("Aug 16")
 *  regardless of which locale the server/browser happens to default
 *  to. Using `undefined` here would silently follow the OS locale
 *  (e.g. producing "16 ago" on a Spanish-locale machine) even in an
 *  English or Korean UI. */
const LABEL_LOCALE = 'en-US'

/** Human-readable label for a bucket key — "Aug 16" (day/week start)
 *  or "Aug 26" (month). */
export function formatBucketLabel(key: string, granularity: BucketGranularity): string {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString(LABEL_LOCALE, { month: 'short', year: '2-digit' })
  }
  const d = new Date(`${key}T00:00:00`)
  return d.toLocaleDateString(LABEL_LOCALE, { month: 'short', day: 'numeric' })
}

/** Human-readable "start – end" label for a date range, e.g.
 *  "Aug 1 – Aug 16, 2026" — used as the KPIs page's period caption
 *  and in the Excel export's summary sheet. */
export function formatDateRangeLabel(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString(LABEL_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}
