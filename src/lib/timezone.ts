// ============================================================
// Business-timezone formatting for anything shown to the AI or used
// to reason about "today"/"now" from the account's own local
// perspective — not just raw server UTC.
//
// Why this exists: the AI's autonomous appointment-scheduling prompt
// (src/lib/ai/defaults.ts's `calendar` block) used to show the model
// `new Date().toISOString()` — always UTC. For an account west of UTC
// (e.g. Guatemala, UTC-6), any time after 6pm local the UTC calendar
// date has already rolled to the next day, so the model reasoned
// about the wrong "today". Formatting with an explicit local offset
// instead fixes both the date and the hour-of-day the model reasons
// about (see `formatWithOffset`).
// ============================================================

/** Formats `date` as an ISO 8601 string with an explicit UTC offset in
 *  `timeZone` (e.g. `2026-08-16T20:15:00-06:00`) instead of
 *  `toISOString()`'s always-UTC `Z` suffix. `new Date(...)` parses the
 *  result back to the exact same instant, so this is safe to use
 *  anywhere a `Date`-parseable string is needed — it only changes how
 *  the instant is *displayed*. */
export function formatWithOffset(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour') === '24' ? '00' : get('hour')
  const minute = get('minute')
  const second = get('second')

  const offsetParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(date)
  const offsetRaw = offsetParts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  // "GMT-06:00" -> "-06:00"; bare "GMT" (some zones at 0 offset) -> "+00:00".
  const offset = offsetRaw === 'GMT' ? '+00:00' : offsetRaw.replace('GMT', '')

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`
}

/** The viewer's own IANA timezone — the fallback for the inbox
 *  helpers below when an account has no `timezone` set yet (rows from
 *  before migration 063) or it's still loading. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** `HH:mm` (24h) for `date` as read in `timeZone`. Used for WhatsApp
 *  message timestamps in the inbox so "07:19" means 07:19 where the
 *  business is, not wherever the teammate viewing the thread happens
 *  to be. Falls back to the viewer's own zone when `timeZone` is
 *  absent. */
export function timeInZone(date: Date | string, timeZone?: string | null): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || browserTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('hour')}:${get('minute')}`
}

/** `yyyy-MM-dd` for `date` as read in `timeZone` — the key the inbox
 *  uses to group messages into day sections and to decide
 *  "Today"/"Yesterday". Computing it in the account's zone keeps the
 *  day boundary where the business is (a message sent at 23:30 local
 *  shouldn't jump into tomorrow just because the viewer is east of
 *  them). Falls back to the viewer's own zone when `timeZone` is
 *  absent. */
export function dateKeyInZone(date: Date | string, timeZone?: string | null): string {
  const d = typeof date === 'string' ? new Date(date) : date
  // 'en-CA' renders a date as yyyy-MM-dd.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || browserTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Validates an IANA timezone identifier the cheap way — asks
 *  `Intl.DateTimeFormat` to use it and see if it throws. Used wherever
 *  a caller-supplied timezone string is persisted (Settings). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** Curated shortlist for the Settings timezone picker — Chat Sandía's
 *  accounts are overwhelmingly Guatemala/Central America businesses
 *  (see docs/SANDIA_diagnostico_tecnico.md), so a short, relevant list
 *  beats dumping all ~450 IANA zones into one dropdown. */
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Guatemala', label: 'Guatemala (GMT-6)' },
  { value: 'America/El_Salvador', label: 'El Salvador (GMT-6)' },
  { value: 'America/Tegucigalpa', label: 'Honduras (GMT-6)' },
  { value: 'America/Managua', label: 'Nicaragua (GMT-6)' },
  { value: 'America/Costa_Rica', label: 'Costa Rica (GMT-6)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (GMT-6)' },
  { value: 'America/Panama', label: 'Panamá (GMT-5)' },
  { value: 'America/Bogota', label: 'Bogotá (GMT-5)' },
  { value: 'America/Lima', label: 'Lima (GMT-5)' },
  { value: 'America/New_York', label: 'New York (GMT-5/-4)' },
  { value: 'America/Santiago', label: 'Santiago (GMT-4/-3)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (GMT-3)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
  { value: 'Europe/Madrid', label: 'Madrid (GMT+1/+2)' },
  { value: 'UTC', label: 'UTC' },
]
