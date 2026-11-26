import { describe, expect, it } from 'vitest'
import { convertUsd, formatCost, estimateBroadcastCost, META_RATES_USD, OTHER_RATE } from './cost-estimate'

describe('estimateBroadcastCost', () => {
  it('prices by recipient country and category', () => {
    const r = estimateBroadcastCost('Marketing', ['+91 95265 79401', '919876543210', '+971501234567'])
    expect(r.lines.map((l) => [l.code, l.count])).toEqual([['971', 1], ['91', 2]]) // sorted by cost
    expect(r.totalUsd).toBeCloseTo(2 * META_RATES_USD['91'].rate.marketing + META_RATES_USD['971'].rate.marketing)
    expect(r.unpriced).toBe(0)
  })

  it('utility is far cheaper than marketing (the saving we pitch)', () => {
    const phones = Array(1000).fill('+919526579401')
    const m = estimateBroadcastCost('Marketing', phones).totalUsd
    const u = estimateBroadcastCost('Utility', phones).totalUsd
    expect(m / u).toBeGreaterThan(5)
  })

  it('longest prefix wins: +971 is UAE, not +97 or +9', () => {
    expect(estimateBroadcastCost('Utility', ['00971501234567']).lines[0].country).toBe('UAE')
  })

  it('unknown countries use the fallback rate; junk is unpriced', () => {
    const r = estimateBroadcastCost('Authentication', ['+33612345678', 'abc', ''])
    expect(r.lines[0]).toMatchObject({ code: 'other', count: 1 })
    expect(r.totalUsd).toBeCloseTo(OTHER_RATE.authentication)
    expect(r.unpriced).toBe(2)
  })

  it('empty audience costs nothing', () => {
    expect(estimateBroadcastCost('Marketing', [])).toEqual({ totalUsd: 0, lines: [], unpriced: 0 })
  })
})

describe('convertUsd', () => {
  it('converts known currencies and falls back to USD', () => {
    expect(convertUsd(1, 'INR')).toEqual({ amount: 84, currency: 'INR' })
    expect(convertUsd(2, 'XYZ')).toEqual({ amount: 2, currency: 'USD' })
  })
})

describe('formatCost', () => {
  it('never rounds a real cost down to zero', () => {
    expect(formatCost(0.0103, 'USD')).toMatch(/0\.010/)
    expect(formatCost(0.0103, 'INR')).toMatch(/0\.865/)
    expect(formatCost(0, 'USD')).toMatch(/0/)
    expect(formatCost(250, 'INR')).toMatch(/21,000|21000/)
  })
})
