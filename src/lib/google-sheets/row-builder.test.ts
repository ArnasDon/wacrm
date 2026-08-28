import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildRowForEvent } from './row-builder'

// Mock: db.from(t).select().eq().eq().maybeSingle()  and  .order() for lists.
function makeDb(fixtures: {
  deal?: Record<string, unknown> | null
  stage?: Record<string, unknown> | null
  contact?: Record<string, unknown> | null
  profile?: Record<string, unknown> | null
  quote?: Record<string, unknown> | null
  quoteItems?: Record<string, unknown>[]
  broadcast?: Record<string, unknown> | null
}): SupabaseClient {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: fixtures.quoteItems ?? [], error: null }),
        maybeSingle: () => {
          const map: Record<string, unknown> = {
            deals: fixtures.deal,
            pipeline_stages: fixtures.stage,
            contacts: fixtures.contact,
            profiles: fixtures.profile,
            quotes: fixtures.quote,
            broadcasts: fixtures.broadcast,
          }
          return Promise.resolve({ data: map[table] ?? null, error: null })
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('buildRowForEvent', () => {
  it('returns null for an unmapped event', async () => {
    const row = await buildRowForEvent(makeDb({}), 'a', 'message.received', {}, 'Ventas')
    expect(row).toBeNull()
  })

  it('returns null when the referenced deal no longer exists', async () => {
    const row = await buildRowForEvent(makeDb({ deal: null }), 'a', 'deal.won', { deal_id: 'd1' }, 'Ventas')
    expect(row).toBeNull()
  })

  it('builds a deal.won row with enriched stage / contact / agent', async () => {
    const db = makeDb({
      deal: { id: 'd1', title: 'Camisa x100', value: 1500, currency: 'GTQ', stage_id: 's1', contact_id: 'c1', assigned_to: 'u1', status: 'won', won_at: '2026-08-10T00:00:00Z' },
      stage: { name: 'Cerrada' },
      contact: { name: 'Ana', phone: '502111' },
      profile: { full_name: 'Vendedor Uno', email: 'v1@x.com' },
    })
    const row = await buildRowForEvent(db, 'a', 'deal.won', { deal_id: 'd1', source: 'human' }, 'Ventas')
    expect(row).not.toBeNull()
    expect(row!.tab).toBe('Ventas')
    expect(row!.header[0]).toBe('Evento')
    // [event, date, title, value, currency, stage, contact, phone, agent, status, wonAt, source, id]
    expect(row!.values[0]).toBe('deal.won')
    expect(row!.values[2]).toBe('Camisa x100')
    expect(row!.values[3]).toBe(1500)
    expect(row!.values[4]).toBe('GTQ')
    expect(row!.values[5]).toBe('Cerrada')
    expect(row!.values[6]).toBe('Ana')
    expect(row!.values[8]).toBe('Vendedor Uno')
    expect(row!.values[11]).toBe('human')
    expect(row!.values[12]).toBe('d1')
  })

  it('routes quote.created to a "<base> - Cotizaciones" tab with an items summary', async () => {
    const db = makeDb({
      quote: { id: 'q1', contact_id: 'c1', currency: 'GTQ', subtotal: 1000, total: 1120, status: 'sent', customer_nit: 'CF' },
      quoteItems: [
        { description: 'Camisa', quantity: 2, line_total: 300 },
        { description: 'Pantalón', quantity: 1, line_total: 700 },
      ],
      contact: { name: 'Ana', phone: '502111' },
    })
    const row = await buildRowForEvent(db, 'a', 'quote.created', { quote_id: 'q1', contact_id: 'c1', source: 'ai_action' }, 'Ventas')
    expect(row!.tab).toBe('Ventas - Cotizaciones')
    expect(row!.values[0]).toBe('quote.created')
    expect(row!.values[2]).toBe('Ana')
    expect(row!.values[4]).toBe('CF')
    expect(row!.values[5]).toBe(2) // item count
    expect(row!.values[6]).toBe('2x Camisa | 1x Pantalón')
    expect(row!.values[8]).toBe(1120) // total
  })

  it('routes contact.created to a "<base> - Leads" tab', async () => {
    const db = makeDb({ contact: { name: 'Beto', phone: '502222', email: 'b@x.com', company: 'ACME', lead_temperature: 'warm', created_at: 'x' } })
    const row = await buildRowForEvent(db, 'a', 'contact.created', { contact_id: 'c9', source: 'whatsapp' }, 'Ventas')
    expect(row!.tab).toBe('Ventas - Leads')
    expect(row!.values[2]).toBe('Beto')
    expect(row!.values[7]).toBe('whatsapp')
  })
})
