/**
 * Decide whether a `time_based` automation should fire on this cron tick.
 *
 * Supports:
 *   - Daily `HH:mm` (24h) in an IANA timezone (defaults to UTC).
 *   - Standard 5-field cron (`min hour dom month dow`) with `*`, lists,
 *     and ranges — enough for schedules like `0 9 * * 1-5`.
 */

interface ZonedParts {
  minute: number
  hour: number
  dayOfMonth: number
  month: number
  /** 0 = Sunday … 6 = Saturday (cron convention). */
  dayOfWeek: number
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hour12: false,
  })
  const parts = fmt.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    minute: get('minute'),
    hour: get('hour'),
    dayOfMonth: get('day'),
    month: get('month'),
    dayOfWeek: dowMap[weekday] ?? 0,
  }
}

function fieldMatches(expr: string, value: number): boolean {
  const e = expr.trim()
  if (e === '*') return true
  if (e.includes(',')) {
    return e.split(',').some((part) => fieldMatches(part.trim(), value))
  }
  if (e.includes('-')) {
    const [from, to] = e.split('-').map((s) => Number(s.trim()))
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false
    return value >= from && value <= to
  }
  const n = Number(e)
  return Number.isFinite(n) && n === value
}

function matchesDailyTime(hhmm: string, timeZone: string, now: Date): boolean {
  const [hStr, mStr] = hhmm.split(':')
  const targetHour = Number(hStr)
  const targetMinute = Number(mStr)
  if (
    !Number.isFinite(targetHour) ||
    !Number.isFinite(targetMinute) ||
    targetHour < 0 ||
    targetHour > 23 ||
    targetMinute < 0 ||
    targetMinute > 59
  ) {
    return false
  }
  const { hour, minute } = zonedParts(now, timeZone)
  return hour === targetHour && minute === targetMinute
}

function matchesCron(fields: string[], timeZone: string, now: Date): boolean {
  if (fields.length !== 5) return false
  const { minute, hour, dayOfMonth, month, dayOfWeek } = zonedParts(now, timeZone)
  return (
    fieldMatches(fields[0], minute) &&
    fieldMatches(fields[1], hour) &&
    fieldMatches(fields[2], dayOfMonth) &&
    fieldMatches(fields[3], month) &&
    fieldMatches(fields[4], dayOfWeek)
  )
}

/**
 * Returns true when `schedule` matches the current minute in `timezone`
 * and the automation has not already fired within the last ~55 seconds
 * (guards against overlapping cron invocations).
 */
export function isScheduleDue(
  schedule: string,
  timezone: string | undefined,
  lastExecutedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const tz = timezone?.trim() || 'UTC'
  const s = schedule.trim()
  if (!s) return false

  if (lastExecutedAt) {
    const last = new Date(lastExecutedAt).getTime()
    if (!Number.isNaN(last) && now.getTime() - last < 55_000) {
      return false
    }
  }

  if (/^\d{1,2}:\d{2}$/.test(s)) {
    return matchesDailyTime(s, tz, now)
  }

  const fields = s.split(/\s+/).filter(Boolean)
  if (fields.length === 5) {
    return matchesCron(fields, tz, now)
  }

  return false
}
