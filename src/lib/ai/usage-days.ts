export const DEFAULT_USAGE_TIME_ZONE = 'UTC'

export function resolveTimeZone(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_USAGE_TIME_ZONE
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: raw }).resolvedOptions().timeZone
  } catch {
    return DEFAULT_USAGE_TIME_ZONE
  }
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

export function zonedDayKey(instant: Date | string, timeZone: string): string {
  const p = zonedParts(typeof instant === 'string' ? new Date(instant) : instant, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function zonedLastNDayKeys(n: number, timeZone: string, now: Date = new Date()): string[] {
  const [y, m, d] = zonedDayKey(now, timeZone).split('-').map(Number)
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10))
  }
  return keys
}

export function zonedDayStart(dayKey: string, timeZone: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number)
  const wallClockAsUtc = Date.UTC(y, m - 1, d)
  const firstGuess = wallClockAsUtc - offsetMs(new Date(wallClockAsUtc), timeZone)
  return new Date(wallClockAsUtc - offsetMs(new Date(firstGuess), timeZone))
}
