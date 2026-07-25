import { describe, expect, it } from 'vitest'

import { parseDayKey, utcDayKey, utcDayKeyDaysAgo } from './day-key'

describe('utcDayKey', () => {
  it('uses UTC, not the runtime timezone', () => {
    // 01:30 UTC on the 26th is still the 25th in Peru (UTC-5). The
    // whole point of this helper is that it does NOT shift with the
    // machine it runs on, so the answer is the 26th either way.
    expect(utcDayKey(new Date('2026-07-26T01:30:00Z'))).toBe('2026-07-26')
    expect(utcDayKey(new Date('2026-07-25T23:59:59Z'))).toBe('2026-07-25')
  })
})

describe('utcDayKeyDaysAgo', () => {
  it('counts whole days back from the reference date', () => {
    const from = new Date('2026-07-26T12:00:00Z')
    expect(utcDayKeyDaysAgo(0, from)).toBe('2026-07-26')
    expect(utcDayKeyDaysAgo(3, from)).toBe('2026-07-23')
  })

  it('crosses month and year boundaries', () => {
    expect(utcDayKeyDaysAgo(1, new Date('2026-03-01T12:00:00Z'))).toBe('2026-02-28')
    expect(utcDayKeyDaysAgo(1, new Date('2026-01-01T12:00:00Z'))).toBe('2025-12-31')
  })
})

describe('parseDayKey', () => {
  it('accepts a well-formed day', () => {
    expect(parseDayKey('2026-07-25')).toBe('2026-07-25')
  })

  it('accepts a leap day in a leap year', () => {
    expect(parseDayKey('2024-02-29')).toBe('2024-02-29')
  })

  it('rejects a day that does not exist', () => {
    // The regex passes these; only the Date round-trip catches them.
    // Without it Postgres raises an opaque error at insert time.
    expect(parseDayKey('2026-02-31')).toBeNull()
    expect(parseDayKey('2026-13-01')).toBeNull()
    expect(parseDayKey('2025-02-29')).toBeNull()
  })

  it('rejects wrong shapes and non-strings', () => {
    expect(parseDayKey('2026-7-5')).toBeNull()
    expect(parseDayKey('25/07/2026')).toBeNull()
    expect(parseDayKey('2026-07-25T10:00:00Z')).toBeNull()
    expect(parseDayKey('')).toBeNull()
    expect(parseDayKey(null)).toBeNull()
    expect(parseDayKey(undefined)).toBeNull()
    expect(parseDayKey(20260725)).toBeNull()
  })

  it('rejects years that would hide the entry forever', () => {
    expect(parseDayKey('9999-12-31')).toBeNull()
    expect(parseDayKey('1999-12-31')).toBeNull()
  })

  it('allows next year, for a browser ahead of the server', () => {
    const nextYear = new Date().getUTCFullYear() + 1
    expect(parseDayKey(`${nextYear}-01-01`)).toBe(`${nextYear}-01-01`)
  })
})
