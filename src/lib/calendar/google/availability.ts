import { TZDate } from '@date-fns/tz'
import { addDays, addMinutes, startOfDay } from 'date-fns'
import type { BusinessHours, Weekday } from '@/lib/eter/repo/calendar-config.repo'
import type { BusyInterval } from './client'

// ============================================================
// Turn "busy intervals from Google + confirmed bookings" into actual
// offerable meeting slots, honoring the account's business hours,
// buffer between meetings, and minimum lead time — the two knobs
// (`buffer_min`, `min_lead_time_min`) that didn't exist in any of the
// n8n reference workflows this project studied, and are a hard
// requirement of this build (see the Fase 2 task brief).
//
// Everything here operates on absolute UTC `Date`/`BusyInterval`
// instants; `timezone` only controls how calendar-day and
// business-hours boundaries are computed (mirrors
// src/lib/calendar/date-resolver.ts — never UTC, never the server's
// local zone).
// ============================================================

export interface AvailabilityConfig {
  timezone: string
  businessHours: BusinessHours
  bufferMin: number
  minLeadTimeMin: number
}

export interface AvailabilitySlot {
  start: Date
  end: Date
}

const WEEKDAY_KEYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function parseHHMM(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':').map(Number)
  return { hour: h, minute: m ?? 0 }
}

/** Subtract `busy` (already merged/sorted, non-overlapping) from a
 *  single `[start, end)` window, returning the free remainder as zero
 *  or more sub-intervals. */
function subtractBusy(window: AvailabilitySlot, busy: BusyInterval[]): AvailabilitySlot[] {
  const free: AvailabilitySlot[] = []
  let cursor = window.start
  for (const b of busy) {
    if (b.end <= cursor || b.start >= window.end) continue // no overlap with what's left
    if (b.start > cursor) free.push({ start: cursor, end: new Date(Math.min(b.start.getTime(), window.end.getTime())) })
    if (b.end > cursor) cursor = new Date(Math.min(Math.max(b.end.getTime(), cursor.getTime()), window.end.getTime()))
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end })
  return free.filter((f) => f.start < f.end)
}

/** Merge overlapping/adjacent busy intervals, each padded by
 *  `bufferMin` on both sides (a booking needs breathing room before AND
 *  after it — offering a slot that starts the instant a prior meeting
 *  ends is exactly what `buffer_min` exists to prevent). */
function mergeAndPadBusy(busy: BusyInterval[], bufferMin: number): BusyInterval[] {
  if (busy.length === 0) return []
  const padded = busy
    .map((b) => ({
      start: addMinutes(b.start, -bufferMin),
      end: addMinutes(b.end, bufferMin),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const merged: BusyInterval[] = [padded[0]]
  for (const cur of padded.slice(1)) {
    const last = merged[merged.length - 1]
    if (cur.start <= last.end) {
      last.end = new Date(Math.max(last.end.getTime(), cur.end.getTime()))
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

/**
 * Compute offerable meeting slots of `durationMin` within
 * `[range.start, range.end)`, honoring:
 *   - `config.businessHours` (per-weekday open/close windows, in
 *     `config.timezone`; a weekday with no entry is closed all day)
 *   - `config.bufferMin` gap kept clear before/after every busy
 *     interval
 *   - `config.minLeadTimeMin` — no slot may start sooner than `now +
 *     minLeadTimeMin` (so the bot can never offer "in 5 minutes")
 *   - `busyIntervals` — already-committed time, from Google's freeBusy
 *     (src/lib/calendar/google/client.ts `getBusySlots`) merged with
 *     this account's own `confirmed` bookings
 *     (`findConfirmedBookingsInRange` in bookings.repo.ts) by the
 *     caller — this function is intentionally storage-agnostic.
 *
 * Slots are generated at `durationMin` steps from the start of each
 * free sub-window (i.e. back-to-back, not overlapping) — this is what
 * keeps a 30-minute default duration from proposing every possible
 * 1-minute-granularity start time.
 */
export function calculateAvailability(
  config: AvailabilityConfig,
  range: { start: Date; end: Date },
  durationMin: number,
  busyIntervals: BusyInterval[],
  now: Date = new Date(),
): AvailabilitySlot[] {
  if (durationMin <= 0 || range.end <= range.start) return []

  const earliestBookable = addMinutes(now, config.minLeadTimeMin)
  const paddedBusy = mergeAndPadBusy(busyIntervals, config.bufferMin)
  const slots: AvailabilitySlot[] = []

  let day: TZDate = new TZDate(
    startOfDay(new TZDate(range.start.getTime(), config.timezone)).getTime(),
    config.timezone,
  )
  const rangeEndTz = new TZDate(range.end.getTime(), config.timezone)

  while (day < rangeEndTz) {
    const weekday = WEEKDAY_KEYS[day.getDay()]
    const windows = config.businessHours[weekday] ?? []

    for (const [openStr, closeStr] of windows) {
      const { hour: openH, minute: openM } = parseHHMM(openStr)
      const { hour: closeH, minute: closeM } = parseHHMM(closeStr)
      const y = day.getFullYear()
      const m = day.getMonth()
      const d = day.getDate()

      let windowStart: Date = new TZDate(y, m, d, openH, openM, 0, config.timezone)
      let windowEnd: Date = new TZDate(y, m, d, closeH, closeM, 0, config.timezone)

      if (windowStart < range.start) windowStart = range.start
      if (windowStart < earliestBookable) windowStart = earliestBookable
      if (windowEnd > range.end) windowEnd = range.end
      if (windowStart >= windowEnd) continue

      const freeSubWindows = subtractBusy({ start: windowStart, end: windowEnd }, paddedBusy)
      for (const free of freeSubWindows) {
        let slotStart = free.start
        while (true) {
          const slotEnd = addMinutes(slotStart, durationMin)
          if (slotEnd > free.end) break
          slots.push({ start: slotStart, end: slotEnd })
          slotStart = slotEnd
        }
      }
    }

    day = addDays(day, 1)
  }

  return slots
}
