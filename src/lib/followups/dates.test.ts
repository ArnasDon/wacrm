import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  bucketFor,
  daysBetween,
  isIsoDate,
  renewalFollowupDate,
  todayIso,
} from './dates'

describe('follow-up dates', () => {
  it('adds days across month/year/leap boundaries', () => {
    expect(addDaysIso('2026-12-20', 15)).toBe('2027-01-04')
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('counts days between', () => {
    expect(daysBetween('2026-10-30', '2026-10-31')).toBe(1)
    expect(daysBetween('2026-10-30', '2026-10-28')).toBe(-2)
  })
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-10-30')).toBe(true)
    expect(isIsoDate('30/10/2026')).toBe(false)
  })
  it('formats today in local time', () => {
    expect(todayIso(new Date(2026, 9, 30, 23, 59))).toBe('2026-10-30')
  })
  it('buckets', () => {
    expect(bucketFor('2026-10-29', '2026-10-30')).toBe('overdue')
    expect(bucketFor('2026-10-30', '2026-10-30')).toBe('today')
    expect(bucketFor('2026-10-31', '2026-10-30')).toBe('tomorrow')
    expect(bucketFor('2026-11-15', '2026-10-30')).toBe('upcoming')
  })
  it('renewal: policy expiring in 3 months -> remind when the 45-day window opens', () => {
    // expiry 2027-01-30, window opens 2026-12-16
    expect(renewalFollowupDate('2027-01-30', '2026-10-30')).toEqual({
      date: '2026-12-16',
      windowAlreadyOpen: false,
    })
  })
  it('renewal: window already open -> remind tomorrow', () => {
    expect(renewalFollowupDate('2026-12-01', '2026-10-30')).toEqual({
      date: '2026-10-31',
      windowAlreadyOpen: true,
    })
  })
})
