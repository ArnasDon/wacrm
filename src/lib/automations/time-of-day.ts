export const LEGACY_CONDITION_TIMEZONE = 'UTC'

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

export function minutesInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function parseClock(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function isWithinTimeWindow(
  window: string | undefined,
  now: Date,
  timeZone: string | undefined,
): boolean {
  const [from, to] = (window ?? '').split('-')
  if (!from || !to) return false
  const zone = timeZone ?? LEGACY_CONDITION_TIMEZONE
  if (!isValidTimeZone(zone)) return false
  const mins = minutesInTimeZone(now, zone)
  const f = parseClock(from)
  const t = parseClock(to)
  return f <= t ? mins >= f && mins < t : mins >= f || mins < t
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimeZone(zone) ? zone : LEGACY_CONDITION_TIMEZONE
  } catch {
    return LEGACY_CONDITION_TIMEZONE
  }
}

export function listTimeZones(current?: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const zones = new Set<string>([LEGACY_CONDITION_TIMEZONE, ...supported])
  if (current && isValidTimeZone(current)) zones.add(current)
  return [...zones]
}

export function withConditionTimezone(
  stepConfig: Record<string, unknown>,
  timeZone: string,
): Record<string, unknown> {
  if (stepConfig.subject !== 'time_of_day' || stepConfig.timezone) return stepConfig
  return { ...stepConfig, timezone: timeZone }
}

export function editConditionConfig(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  timeZone: string,
): Record<string, unknown> {
  return withConditionTimezone({ ...current, ...patch }, timeZone)
}
