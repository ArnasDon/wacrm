import { describe, it, expect } from 'vitest'
import {
  formatWithOffset,
  isValidTimeZone,
  timeInZone,
  dateKeyInZone,
} from './timezone'

describe('formatWithOffset', () => {
  it('formats a UTC instant with the Guatemala (UTC-6, no DST) offset', () => {
    // 2026-08-17T02:30:00Z is 2026-08-16T20:30:00-06:00 in Guatemala —
    // the exact "already rolled over to the next UTC day" case that
    // caused the reported bug.
    const date = new Date('2026-08-17T02:30:00.000Z')
    expect(formatWithOffset(date, 'America/Guatemala')).toBe('2026-08-16T20:30:00-06:00')
  })

  it('round-trips to the same instant when re-parsed', () => {
    const date = new Date('2026-08-17T02:30:00.000Z')
    const formatted = formatWithOffset(date, 'America/Guatemala')
    expect(new Date(formatted).getTime()).toBe(date.getTime())
  })

  it('formats UTC as +00:00', () => {
    const date = new Date('2026-08-16T12:00:00.000Z')
    expect(formatWithOffset(date, 'UTC')).toBe('2026-08-16T12:00:00+00:00')
  })

  it('handles a positive offset (Madrid, UTC+2 in August/DST)', () => {
    const date = new Date('2026-08-16T12:00:00.000Z')
    expect(formatWithOffset(date, 'Europe/Madrid')).toBe('2026-08-16T14:00:00+02:00')
  })
})

describe('isValidTimeZone', () => {
  it('accepts a real IANA identifier', () => {
    expect(isValidTimeZone('America/Guatemala')).toBe(true)
  })

  it('rejects garbage', () => {
    expect(isValidTimeZone('Not/A/Zone')).toBe(false)
  })
})

describe('timeInZone', () => {
  it('renders an instant as HH:mm in the given zone', () => {
    // 13:19:08 UTC = 07:19 in Guatemala (UTC-6) — the exact case the
    // inbox was showing wrong (raw UTC) before this change.
    expect(timeInZone('2026-08-29T13:19:08.000Z', 'America/Guatemala')).toBe('07:19')
  })

  it('accepts a Date as well as a string', () => {
    expect(timeInZone(new Date('2026-08-29T13:19:08.000Z'), 'America/Guatemala')).toBe('07:19')
  })

  it('zero-pads the hour', () => {
    expect(timeInZone('2026-08-29T09:05:00.000Z', 'UTC')).toBe('09:05')
  })

  it('falls back to a valid HH:mm when no zone is passed', () => {
    expect(timeInZone('2026-08-29T13:19:08.000Z')).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('dateKeyInZone', () => {
  it('returns yyyy-MM-dd for the date as read in the zone', () => {
    // 02:30 UTC on the 30th is still the 29th in Guatemala.
    expect(dateKeyInZone('2026-08-30T02:30:00.000Z', 'America/Guatemala')).toBe('2026-08-29')
  })

  it('rolls to the next day for the same instant in a positive-offset zone', () => {
    expect(dateKeyInZone('2026-08-29T23:30:00.000Z', 'Europe/Madrid')).toBe('2026-08-30')
  })

  it('falls back to a valid key when no zone is passed', () => {
    expect(dateKeyInZone('2026-08-29T13:19:08.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
