import { describe, it, expect } from 'vitest'
import { calculateAvailability, type AvailabilityConfig } from './availability'

const baseConfig: AvailabilityConfig = {
  timezone: 'Europe/Lisbon',
  businessHours: {
    mon: [['09:00', '13:00'], ['14:00', '18:00']],
    tue: [['09:00', '18:00']],
  },
  bufferMin: 15,
  minLeadTimeMin: 60,
}

// 2026-08-24 is a Monday.
const monday = { start: new Date('2026-08-24T00:00:00Z'), end: new Date('2026-08-25T00:00:00Z') }
const earlyNow = new Date('2026-08-20T00:00:00Z') // well before the range → lead time is not the binding constraint

describe('calculateAvailability', () => {
  it('returns back-to-back slots inside a single business-hours window with no busy time', () => {
    const slots = calculateAvailability(baseConfig, monday, 30, [], earlyNow)
    // 09:00–13:00 (4h = 8 slots) + 14:00–18:00 (4h = 8 slots) = 16 slots of 30min
    expect(slots).toHaveLength(16)
    expect(slots[0].start.getTime()).toBe(new Date('2026-08-24T08:00:00Z').getTime()) // 09:00 Lisbon (WEST, UTC+1 in Aug)
  })

  it('returns nothing on a day with no business-hours entry', () => {
    // 2026-08-23 is a Sunday — not in businessHours at all.
    const sunday = { start: new Date('2026-08-23T00:00:00Z'), end: new Date('2026-08-24T00:00:00Z') }
    expect(calculateAvailability(baseConfig, sunday, 30, [], earlyNow)).toEqual([])
  })

  it('removes a busy interval plus its buffer padding on both sides', () => {
    // A meeting 10:00–10:30 Lisbon (09:00–09:30 UTC) with 15min buffer
    // should block 09:45–10:45 Lisbon from offering new slots.
    const busy = [{ start: new Date('2026-08-24T09:00:00Z'), end: new Date('2026-08-24T09:30:00Z') }]
    const slots = calculateAvailability(baseConfig, monday, 30, busy, earlyNow)
    const overlapsBlocked = slots.some(
      (s) => s.start < new Date('2026-08-24T09:45:00Z') && s.end > new Date('2026-08-24T08:45:00Z'),
    )
    expect(overlapsBlocked).toBe(false)
  })

  it('never offers a slot starting before now + minLeadTimeMin', () => {
    // "now" is 2026-08-24T08:30:00Z (09:30 Lisbon) with a 60-minute lead
    // time → nothing may start before 10:30 Lisbon (09:30Z + 60min = 09:30Z? let's just assert the floor).
    const now = new Date('2026-08-24T08:30:00Z')
    const slots = calculateAvailability(baseConfig, monday, 30, [], now)
    const earliestBookable = new Date(now.getTime() + 60 * 60 * 1000)
    for (const s of slots) {
      expect(s.start.getTime()).toBeGreaterThanOrEqual(earliestBookable.getTime())
    }
  })

  it('returns [] for a non-positive duration', () => {
    expect(calculateAvailability(baseConfig, monday, 0, [], earlyNow)).toEqual([])
  })

  it('clips slots to the requested range even when business hours extend beyond it', () => {
    const narrowRange = { start: new Date('2026-08-24T08:30:00Z'), end: new Date('2026-08-24T09:00:00Z') }
    const slots = calculateAvailability(baseConfig, narrowRange, 30, [], earlyNow)
    for (const s of slots) {
      expect(s.start.getTime()).toBeGreaterThanOrEqual(narrowRange.start.getTime())
      expect(s.end.getTime()).toBeLessThanOrEqual(narrowRange.end.getTime())
    }
  })
})
