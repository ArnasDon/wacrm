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
 * Which days the weekly agenda shows, as an offset from Monday
 * (0 = Monday … 6 = Sunday). Sunday (6) is deliberately excluded for
 * now — add it here to turn the column on later; getWeekDates below
 * (and every caller that maps over its result) needs no other change.
 */
export const WEEK_DAY_OFFSETS = [0, 1, 2, 3, 4, 5] as const

/**
 * Local-day keys (YYYY-MM-DD) for WEEK_DAY_OFFSETS within the
 * Monday-start calendar week containing `d`.
 */
export function getWeekDates(d: Date = new Date()): string[] {
  const jsDow = d.getDay() // 0 = Sunday … 6 = Saturday
  const mondayOffset = (jsDow + 6) % 7 // 0 = Monday … 6 = Sunday
  const monday = startOfLocalDay(d)
  monday.setDate(monday.getDate() - mondayOffset)
  return WEEK_DAY_OFFSETS.map((offset) => {
    const day = new Date(monday)
    day.setDate(day.getDate() + offset)
    return localDayKey(day)
  })
}
