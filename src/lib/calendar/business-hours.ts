import type { BusinessHours, Weekday } from '@/lib/eter/repo/calendar-config.repo'

// ============================================================
// Pure validation for the `business_hours` JSONB shape (migration
// 037_eter_agent.sql): `{ mon: [["09:00","13:00"], ["14:00","19:00"]],
// ... }`. Used by the calendar settings PATCH route before it's ever
// handed to `upsertCalendarConfig` — malformed hours (bad time
// strings, end before start, an unknown weekday key) should fail the
// request with a clear message rather than get silently written and
// break `calculateAvailability` (availability.ts) downstream, which
// assumes this shape is already valid.
// ============================================================

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export class BusinessHoursError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BusinessHoursError'
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Validate an unknown value as a `BusinessHours` object. Throws
 * `BusinessHoursError` with a specific, user-facing message on the
 * first problem found. Returns the value narrowed to `BusinessHours`
 * on success (same object, not a copy — callers that need a
 * defensive copy should clone before passing it in).
 */
export function validateBusinessHours(value: unknown): BusinessHours {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BusinessHoursError('business_hours must be an object keyed by weekday.')
  }

  const input = value as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!WEEKDAYS.includes(key as Weekday)) {
      throw new BusinessHoursError(
        `business_hours has an unknown day key "${key}" — expected one of ${WEEKDAYS.join(', ')}.`,
      )
    }
    const windows = input[key]
    if (windows === undefined || windows === null) continue
    if (!Array.isArray(windows)) {
      throw new BusinessHoursError(`business_hours.${key} must be an array of [start, end] windows.`)
    }
    let previousEnd = -1
    for (const window of windows) {
      if (!Array.isArray(window) || window.length !== 2) {
        throw new BusinessHoursError(
          `business_hours.${key} has an invalid window — expected ["HH:MM", "HH:MM"].`,
        )
      }
      const [start, end] = window
      if (typeof start !== 'string' || typeof end !== 'string' || !TIME_RE.test(start) || !TIME_RE.test(end)) {
        throw new BusinessHoursError(
          `business_hours.${key} has a window with a non-"HH:MM" time ("${start}"–"${end}").`,
        )
      }
      const startMin = toMinutes(start)
      const endMin = toMinutes(end)
      if (endMin <= startMin) {
        throw new BusinessHoursError(
          `business_hours.${key} window "${start}"–"${end}" ends before (or at) its start.`,
        )
      }
      if (startMin < previousEnd) {
        throw new BusinessHoursError(
          `business_hours.${key} has overlapping or out-of-order windows.`,
        )
      }
      previousEnd = endMin
    }
  }

  return input as BusinessHours
}
