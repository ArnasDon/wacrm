import { describe, it, expect } from 'vitest'
import {
  cac,
  conversionRate,
  conversionRateSeries,
  countQualifiedLeads,
  leadsSeries,
  periodDelta,
  qualifiedLeadsSeries,
  temperatureDistribution,
  wonDealsSeries,
} from './compute'
import type { LeadRow, WonDealRow } from './types'

describe('conversionRate', () => {
  it('divides won deals by leads and expresses as a percentage', () => {
    expect(conversionRate(5, 20)).toBe(25)
  })

  it('returns null (not 0 or NaN) when there were no leads', () => {
    expect(conversionRate(0, 0)).toBeNull()
    expect(conversionRate(3, 0)).toBeNull()
  })
})

describe('cac', () => {
  it('divides spend by customers acquired', () => {
    expect(cac(1000, 4)).toBe(250)
  })

  it('returns null when no customers were acquired', () => {
    expect(cac(1000, 0)).toBeNull()
  })

  it('returns null for a negative customer count (defensive)', () => {
    expect(cac(1000, -1)).toBeNull()
  })
})

describe('periodDelta', () => {
  it('reports a positive delta with a + sign and arrow-up sign', () => {
    const d = periodDelta(30, 20, 'vs periodo anterior')
    expect(d.sign).toBe(1)
    expect(d.label).toBe('+10 vs periodo anterior')
  })

  it('reports a negative delta', () => {
    const d = periodDelta(15, 20, 'vs periodo anterior')
    expect(d.sign).toBe(-1)
    expect(d.label).toBe('-5 vs periodo anterior')
  })

  it('reports zero change', () => {
    const d = periodDelta(20, 20, 'vs periodo anterior')
    expect(d.sign).toBe(0)
    expect(d.label).toBe('+0 vs periodo anterior')
  })

  it('applies a unit suffix and decimal precision', () => {
    const d = periodDelta(25.4, 20.1, 'vs periodo anterior', { unit: '%', decimals: 1 })
    expect(d.label).toBe('+5.3% vs periodo anterior')
  })
})

describe('countQualifiedLeads / temperatureDistribution', () => {
  const leads: LeadRow[] = [
    { id: '1', created_at: '2026-08-01T00:00:00Z', lead_temperature: 'hot' },
    { id: '2', created_at: '2026-08-02T00:00:00Z', lead_temperature: 'warm' },
    { id: '3', created_at: '2026-08-03T00:00:00Z', lead_temperature: 'cold' },
    { id: '4', created_at: '2026-08-04T00:00:00Z', lead_temperature: null },
  ]

  it('counts only warm and hot leads as qualified', () => {
    expect(countQualifiedLeads(leads)).toBe(2)
  })

  it('buckets every lead into exactly one temperature bucket', () => {
    expect(temperatureDistribution(leads)).toEqual({ cold: 1, warm: 1, hot: 1, unclassified: 1 })
  })
})

describe('leadsSeries / wonDealsSeries / qualifiedLeadsSeries', () => {
  const window = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 3) }

  const leads: LeadRow[] = [
    { id: '1', created_at: '2026-08-01T10:00:00', lead_temperature: 'hot' },
    { id: '2', created_at: '2026-08-01T18:00:00', lead_temperature: 'cold' },
    { id: '3', created_at: '2026-08-03T08:00:00', lead_temperature: 'warm' },
  ]

  it('buckets leads by day, zero-filling days with no activity', () => {
    expect(leadsSeries(leads, window, 'day')).toEqual([
      { key: '2026-08-01', value: 2 },
      { key: '2026-08-02', value: 0 },
      { key: '2026-08-03', value: 1 },
    ])
  })

  it('qualifiedLeadsSeries only counts warm/hot leads per bucket', () => {
    expect(qualifiedLeadsSeries(leads, window, 'day')).toEqual([
      { key: '2026-08-01', value: 1 }, // just the hot one
      { key: '2026-08-02', value: 0 },
      { key: '2026-08-03', value: 1 }, // the warm one
    ])
  })

  it('wonDealsSeries prefers won_at, falls back to updated_at when null', () => {
    const wonDeals: WonDealRow[] = [
      { id: 'd1', won_at: '2026-08-01T12:00:00', updated_at: '2026-08-01T12:00:00', value: 100, currency: 'USD' },
      { id: 'd2', won_at: null, updated_at: '2026-08-03T09:00:00', value: 200, currency: 'USD' },
    ]
    expect(wonDealsSeries(wonDeals, window, 'day')).toEqual([
      { key: '2026-08-01', value: 1 },
      { key: '2026-08-02', value: 0 },
      { key: '2026-08-03', value: 1 },
    ])
  })
})

describe('conversionRateSeries', () => {
  it('computes per-bucket (won ÷ leads) × 100, 0 for a bucket with no leads', () => {
    const window = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 2) }
    const leads: LeadRow[] = [
      { id: '1', created_at: '2026-08-01T10:00:00', lead_temperature: 'hot' },
      { id: '2', created_at: '2026-08-01T11:00:00', lead_temperature: 'cold' },
    ]
    const wonDeals: WonDealRow[] = [
      { id: 'd1', won_at: '2026-08-01T12:00:00', updated_at: '2026-08-01T12:00:00', value: 100, currency: 'USD' },
    ]
    expect(conversionRateSeries(leads, wonDeals, window, 'day')).toEqual([
      { key: '2026-08-01', value: 50 },
      { key: '2026-08-02', value: 0 },
    ])
  })
})
