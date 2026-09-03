// ============================================================
// Lead-temperature auto-cool — pure decision logic (no I/O). Shared by
// the sweep (src/lib/contacts/temperature-sweep.ts) and its unit tests.
//
// A warm/hot lead that has gone quiet steps ONE notch cooler
// (hot -> warm -> cold) per sweep, and only once BOTH clocks have run
// past `cooldownDays`:
//   - silence:      no thread activity since `lastActivityAt`
//   - stability:    the current temperature has held since
//                   `temperatureUpdatedAt` (so a fresh classification
//                   gets its own full grace period before it decays)
// `cold` is terminal — the sweep never touches it.
// ============================================================

export type CoolableTemperature = 'warm' | 'hot'
export type LeadTemperatureValue = 'cold' | 'warm' | 'hot'

const DAY_MS = 86_400_000

/** The next step down. hot -> warm, warm -> cold. */
export function coolerTemperature(current: CoolableTemperature): LeadTemperatureValue {
  return current === 'hot' ? 'warm' : 'cold'
}

export interface CoolDownInput {
  current: LeadTemperatureValue | null | undefined
  /** Most recent activity on the contact's thread(s) — ISO string,
   *  Date, or null when there has never been any. */
  lastActivityAt: string | Date | null
  /** When `current` was last set — ISO string, Date, or null (old rows
   *  from before migration 103's backfill). Null falls back to
   *  `lastActivityAt`. */
  temperatureUpdatedAt: string | Date | null
  now: Date
  cooldownDays: number
}

function toMs(v: string | Date | null): number | null {
  if (v == null) return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Decide whether `current` should cool a notch now, and to what.
 * Returns null when nothing should change.
 */
export function decideCoolDown(
  input: CoolDownInput,
): { from: CoolableTemperature; to: LeadTemperatureValue } | null {
  const { current, now, cooldownDays } = input
  if (current !== 'warm' && current !== 'hot') return null
  if (!Number.isFinite(cooldownDays) || cooldownDays <= 0) return null

  const threshold = cooldownDays * DAY_MS
  const nowMs = now.getTime()

  const lastActivityMs = toMs(input.lastActivityAt)
  // No activity ever recorded → treat as maximally stale (cool it).
  const silentLongEnough =
    lastActivityMs == null || nowMs - lastActivityMs >= threshold
  if (!silentLongEnough) return null

  const tempSetMs = toMs(input.temperatureUpdatedAt) ?? lastActivityMs
  // No stability clock at all → allow the cool (an ancient row).
  const stableLongEnough = tempSetMs == null || nowMs - tempSetMs >= threshold
  if (!stableLongEnough) return null

  return { from: current, to: coolerTemperature(current) }
}
