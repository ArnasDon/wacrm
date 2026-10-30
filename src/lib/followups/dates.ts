// Date helpers for follow-ups. Follow-up dates are plain calendar dates
// ("YYYY-MM-DD"), not instants, so everything here works on that string
// form and never depends on a time zone.

/** Days before policy expiry that renewal opens (Indian motor/health rule of thumb). */
export const RENEWAL_WINDOW_DAYS = 45

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export function addDaysIso(iso: string, days: number): string {
  const m = ISO.exec(iso)
  if (!m) throw new Error(`Bad date: ${iso}`)
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = ISO.exec(fromIso)
  const b = ISO.exec(toIso)
  if (!a || !b) throw new Error('Bad date')
  const A = Date.UTC(+a[1], +a[2] - 1, +a[3])
  const B = Date.UTC(+b[1], +b[2] - 1, +b[3])
  return Math.round((B - A) / 86_400_000)
}

export type FollowupBucket = 'overdue' | 'today' | 'tomorrow' | 'upcoming'

export function bucketFor(due: string, today: string): FollowupBucket {
  const diff = daysBetween(today, due)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  return 'upcoming'
}

/**
 * Policy renewals can only be done inside the last 45 days before expiry,
 * so the useful reminder date is `expiry - 45 days`. If that date has
 * already passed the window is open now: remind tomorrow.
 */
export function renewalFollowupDate(
  expiryIso: string,
  today: string,
  windowDays: number = RENEWAL_WINDOW_DAYS,
): { date: string; windowAlreadyOpen: boolean } {
  const opens = addDaysIso(expiryIso, -windowDays)
  if (daysBetween(today, opens) <= 0) {
    return { date: addDaysIso(today, 1), windowAlreadyOpen: true }
  }
  return { date: opens, windowAlreadyOpen: false }
}
