import { describe, it, expect } from 'vitest'
import { formatWithOffset, isValidTimeZone } from './timezone'

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
