import { describe, expect, it } from 'vitest'
import {
  resolveTimeZone,
  zonedDayKey,
  zonedDayStart,
  zonedLastNDayKeys,
} from './usage-days'

describe('resolveTimeZone', () => {
  it('accepts IANA zones', () => {
    expect(resolveTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles')
    expect(resolveTimeZone('Asia/Seoul')).toBe('Asia/Seoul')
  })

  it('falls back to UTC for missing or invalid zones', () => {
    expect(resolveTimeZone(null)).toBe('UTC')
    expect(resolveTimeZone('')).toBe('UTC')
    expect(resolveTimeZone('Not/AZone')).toBe('UTC')
    expect(resolveTimeZone('<script>')).toBe('UTC')
  })
})

describe('zonedDayKey', () => {
  it('buckets an instant by the requested zone, not the server zone', () => {
    const instant = '2026-05-18T03:30:00Z'
    expect(zonedDayKey(instant, 'UTC')).toBe('2026-05-18')
    expect(zonedDayKey(instant, 'America/Los_Angeles')).toBe('2026-05-17')
    expect(zonedDayKey('2026-05-18T20:00:00Z', 'Asia/Seoul')).toBe('2026-05-19')
  })
})

describe('zonedLastNDayKeys', () => {
  it('ends on the current day in the zone', () => {
    const now = new Date('2026-05-02T05:00:00Z')
    expect(zonedLastNDayKeys(3, 'UTC', now)).toEqual(['2026-04-30', '2026-05-01', '2026-05-02'])
    expect(zonedLastNDayKeys(3, 'America/Los_Angeles', now)).toEqual([
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
    ])
  })
})

describe('zonedDayStart', () => {
  it('returns the instant of local midnight', () => {
    expect(zonedDayStart('2026-05-18', 'UTC').toISOString()).toBe('2026-05-18T00:00:00.000Z')
    expect(zonedDayStart('2026-05-18', 'America/Los_Angeles').toISOString()).toBe(
      '2026-05-18T07:00:00.000Z',
    )
    expect(zonedDayStart('2026-05-18', 'Asia/Seoul').toISOString()).toBe('2026-05-17T15:00:00.000Z')
  })

  it('handles the day after a DST change', () => {
    expect(zonedDayStart('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    )
    expect(zonedDayStart('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    )
  })
})
