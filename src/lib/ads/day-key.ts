/**
 * Calendar-day keys (YYYY-MM-DD) for the ads subsystem.
 *
 * Three different clocks meet in these tables, and conflating them is
 * what made spend rows land a day off:
 *
 *   - The **operator's** day. `localDayKey` (src/lib/dashboard/date-utils.ts)
 *     computes it in the browser's timezone, and that is what the
 *     /campaigns range filter uses. Manual spend entries are dated in
 *     this clock — the client sends the key, so the day someone means
 *     when they type "yesterday" is the day that gets stored.
 *   - The **ad account's** day. Meta reports insight dates in the ad
 *     account's own timezone, and those arrive as `date_start` and are
 *     stored verbatim. We never compute them.
 *   - The **server's** day, which is UTC in production and whatever the
 *     laptop is set to in development. This is the one that must never
 *     leak into stored data: `localDayKey` running server-side silently
 *     files anything entered after ~19:00 in Peru under tomorrow.
 *
 * So: `utcDayKey` only for windows we send to Meta (an explicit,
 * unambiguous clock), and `parseDayKey` to validate whatever a client
 * hands us.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Day key in UTC. Explicitly not "local" — see the module comment. */
export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** `days` whole days before `from`, as a UTC day key. */
export function utcDayKeyDaysAgo(days: number, from: Date = new Date()): string {
  return utcDayKey(new Date(from.getTime() - days * 24 * 60 * 60 * 1000))
}

/**
 * Validate a client-supplied day key, returning it or null.
 *
 * The regex alone is not enough: it happily passes '2026-02-31', which
 * Postgres would then reject at insert time with an opaque error, and
 * '9999-12-31', which would park a spend entry where no date range ever
 * surfaces it again. So the value has to survive a Date round-trip and
 * land in a plausible year.
 */
export function parseDayKey(value: unknown): string | null {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return null

  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  // Catches overflow like '2026-02-31', which Date rolls into March.
  if (utcDayKey(parsed) !== value) return null

  const year = parsed.getUTCFullYear()
  // Upper bound is next year, not this one: a browser a few hours ahead
  // of the server can legitimately be on Jan 1st of the coming year.
  if (year < 2000 || year > new Date().getUTCFullYear() + 1) return null

  return value
}
