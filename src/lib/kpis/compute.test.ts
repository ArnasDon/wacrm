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

// ---- trial metrics --------------------------------------------------

import {
  conversationFirstTimes,
  medianFirstResponseMinutes,
  answeredConversationCount,
  recoveredConversationCount,
  handoffsAdvancedCount,
  briefCompletionPercent,
} from './compute'

describe('conversationFirstTimes + first-response', () => {
  const rows = [
    { conversation_id: 'a', sender_type: 'customer', created_at: '2026-09-01T10:00:00Z' },
    { conversation_id: 'a', sender_type: 'agent', created_at: '2026-09-01T10:06:00Z' },
    { conversation_id: 'a', sender_type: 'customer', created_at: '2026-09-01T11:00:00Z' },
    { conversation_id: 'b', sender_type: 'bot', created_at: '2026-09-01T09:00:00Z' }, // outbound first — not answered
    { conversation_id: 'b', sender_type: 'customer', created_at: '2026-09-01T09:30:00Z' },
    { conversation_id: 'c', sender_type: 'customer', created_at: '2026-09-01T08:00:00Z' }, // never answered
  ]

  it('takes the earliest inbound and earliest outbound per conversation', () => {
    const m = conversationFirstTimes(rows)
    expect(m.get('a')).toEqual({
      firstInMs: Date.parse('2026-09-01T10:00:00Z'),
      firstOutMs: Date.parse('2026-09-01T10:06:00Z'),
    })
    expect(m.get('c')!.firstOutMs).toBeNull()
  })

  it('medians only the answered conversations (outbound after inbound)', () => {
    const m = conversationFirstTimes(rows)
    // only "a" qualifies: 6 minutes
    expect(medianFirstResponseMinutes(m)).toBe(6)
    expect(answeredConversationCount(m)).toBe(1)
  })

  it('returns null median when nothing was answered', () => {
    expect(medianFirstResponseMinutes(conversationFirstTimes([]))).toBeNull()
  })

  it('averages the two middle values for an even set', () => {
    const m = conversationFirstTimes([
      { conversation_id: 'x', sender_type: 'customer', created_at: '2026-09-01T10:00:00Z' },
      { conversation_id: 'x', sender_type: 'agent', created_at: '2026-09-01T10:02:00Z' },
      { conversation_id: 'y', sender_type: 'customer', created_at: '2026-09-01T10:00:00Z' },
      { conversation_id: 'y', sender_type: 'agent', created_at: '2026-09-01T10:08:00Z' },
    ])
    expect(medianFirstResponseMinutes(m)).toBe(5) // (2 + 8) / 2
  })
})

describe('recoveredConversationCount', () => {
  it('counts conversations where a customer replied after the nudge', () => {
    const followups = [
      { conversation_id: 'a', sent_at: '2026-09-01T12:00:00Z' },
      { conversation_id: 'b', sent_at: '2026-09-01T12:00:00Z' },
    ]
    const msgs = [
      { conversation_id: 'a', created_at: '2026-09-01T13:30:00Z' }, // after → recovered
      { conversation_id: 'b', created_at: '2026-09-01T09:00:00Z' }, // before → not
      { conversation_id: 'c', created_at: '2026-09-01T13:00:00Z' }, // no nudge → ignored
    ]
    expect(recoveredConversationCount(followups, msgs)).toBe(1)
  })
})

describe('handoffsAdvancedCount', () => {
  it('counts a handoff whose contact has a deal that moved after it', () => {
    const handoffs = [
      { contact_id: 'c1', ai_handoff_at: '2026-09-01T10:00:00Z' },
      { contact_id: 'c2', ai_handoff_at: '2026-09-01T10:00:00Z' },
      { contact_id: 'c3', ai_handoff_at: '2026-09-01T10:00:00Z' },
    ]
    const deals = [
      { contact_id: 'c1', status: 'open', won_at: null, updated_at: '2026-09-02T00:00:00Z' }, // advanced
      { contact_id: 'c2', status: 'won', won_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }, // won
      { contact_id: 'c3', status: 'open', won_at: null, updated_at: '2026-08-15T00:00:00Z' }, // stale, no move
    ]
    expect(handoffsAdvancedCount(handoffs, deals)).toBe(2)
  })
})

describe('briefCompletionPercent', () => {
  it('is the share of leads that have any captured value', () => {
    expect(briefCompletionPercent(['a', 'b', 'c', 'd'], new Set(['a', 'c']))).toBe(50)
  })
  it('is null with no leads', () => {
    expect(briefCompletionPercent([], new Set())).toBeNull()
  })
})
