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
  customFields?: Record<string, unknown>[]
  customValues?: Record<string, unknown>[]
  account?: Record<string, unknown> | null
  reservation?: Record<string, unknown> | null
}): SupabaseClient {
  return {
    from(table: string) {
      const listByTable: Record<string, unknown[]> = {
        quote_items: fixtures.quoteItems ?? [],
        custom_fields: fixtures.customFields ?? [],
        contact_custom_values: fixtures.customValues ?? [],
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: listByTable[table] ?? [], error: null }),
        maybeSingle: () => {
          const map: Record<string, unknown> = {
            deals: fixtures.deal,
            pipeline_stages: fixtures.stage,
            contacts: fixtures.contact,
            profiles: fixtures.profile,
            quotes: fixtures.quote,
            broadcasts: fixtures.broadcast,
            accounts: fixtures.account ?? { industry_vertical: 'generic' },
            reservation_requests: fixtures.reservation,
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
    // no extra columns for a generic account
    expect(row!.header).toHaveLength(13)
  })

  it('appends the contact reservation fields to the deal row for a hotel account', async () => {
    const db = makeDb({
      account: { industry_vertical: 'hotel' },
      deal: { id: 'd1', title: 'David Duran', value: 3200, currency: 'GTQ', stage_id: 's1', contact_id: 'c1', assigned_to: null, status: 'won', won_at: '' },
      stage: { name: 'Confirmada' },
      contact: { name: 'David Duran', phone: '50255' },
      customFields: [
        { id: 'f_in', field_name: 'Fecha de entrada' },
        { id: 'f_out', field_name: 'Fecha de salida' },
        { id: 'f_room', field_name: 'Habitación' },
      ],
      customValues: [
        { custom_field_id: 'f_in', value: '2026-03-05' },
        { custom_field_id: 'f_out', value: '2026-03-08' },
        { custom_field_id: 'f_room', value: 'Hab 101' },
      ],
    })
    const row = await buildRowForEvent(db, 'a', 'deal.won', { deal_id: 'd1' }, 'Ventas')
    expect(row!.header).toEqual([
      'Evento', 'Fecha', 'Negociación', 'Monto', 'Moneda', 'Etapa',
      'Cliente', 'Teléfono', 'Vendedor', 'Estado', 'Ganada el', 'Origen', 'Deal ID',
      'Fecha de entrada', 'Fecha de salida', 'Habitación',
    ])
    expect(row!.values.slice(13)).toEqual(['2026-03-05', '2026-03-08', 'Hab 101'])
    expect(row!.values.length).toBe(row!.header.length)
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

  it('routes contact.brief_ready to a "<base> - Requerimientos" tab with a column per custom field', async () => {
    const db = makeDb({
      contact: { name: 'Planta Villa Nueva', phone: '50255551234', email: 'compras@planta.gt', company: 'Planta VN' },
      customFields: [
        { id: 'f_med', field_name: 'Medidas' },
        { id: 'f_mat', field_name: 'Material' },
        { id: 'f_plz', field_name: 'Plazo' },
      ],
      customValues: [
        { custom_field_id: 'f_med', value: '1.80 × 0.80 m' },
        { custom_field_id: 'f_plz', value: '6 semanas' },
      ],
    })
    const row = await buildRowForEvent(db, 'a', 'contact.brief_ready', { contact_id: 'c1', deal_id: 'd1' }, 'Ventas')
    expect(row).not.toBeNull()
    expect(row!.tab).toBe('Ventas - Requerimientos')
    expect(row!.header).toEqual(['Evento', 'Fecha', 'Cliente', 'Teléfono', 'Correo', 'Empresa', 'Medidas', 'Material', 'Plazo'])
    // [event, date, name, phone, email, company, Medidas, Material, Plazo]
    expect(row!.values[0]).toBe('contact.brief_ready')
    expect(row!.values[2]).toBe('Planta Villa Nueva')
    expect(row!.values[6]).toBe('1.80 × 0.80 m')
    expect(row!.values[7]).toBe('') // Material not captured for this prospect
    expect(row!.values[8]).toBe('6 semanas')
    expect(row!.values.length).toBe(row!.header.length)
  })

  it('returns null for contact.brief_ready when the contact is gone', async () => {
    const row = await buildRowForEvent(makeDb({ contact: null }), 'a', 'contact.brief_ready', { contact_id: 'c1' }, 'Ventas')
    expect(row).toBeNull()
  })

  it('routes reservation.updated (habitaciones) to its own tab with a rowRef', async () => {
    const db = makeDb({
      contact: { name: 'Ana', phone: '502111' },
      reservation: {
        id: 'r1', category: 'habitaciones', service_name: 'Master Suite',
        guests: 2, check_in: '2026-03-13', check_out: '2026-03-16',
        use_date: null, duration_minutes: null, hall: null, decoration: null,
        estimated_price: 900, status: 'pending', contact_id: 'c1',
      },
    })
    const row = await buildRowForEvent(db, 'a', 'reservation.updated', { reservation_id: 'r1' }, 'Ventas')
    expect(row!.tab).toBe('Ventas - Habitaciones')
    expect(row!.rowRef).toEqual({ table: 'reservation_requests', id: 'r1' })
    expect(row!.header).toEqual([
      'Registrado', 'Habitación', 'Cliente', 'Contacto', 'Huéspedes', 'Check-in', 'Check-out', 'Precio estimado', 'Aprobación',
    ])
    expect(row!.values.slice(1)).toEqual(['Master Suite', 'Ana', '502111', 2, '2026-03-13', '2026-03-16', 900, ''])
    expect(row!.values.length).toBe(row!.header.length)
  })

  it('routes reservation.updated (eventos) with salón + decoración columns; status → Aprobación', async () => {
    const db = makeDb({
      contact: { name: 'Beto', phone: '502222' },
      reservation: {
        id: 'r2', category: 'eventos', service_name: 'Boda',
        guests: 80, check_in: null, check_out: null, use_date: '2026-05-01',
        duration_minutes: null, hall: 'Salón Jardín', decoration: 'Rústica',
        estimated_price: 15000, status: 'approved', contact_id: 'c2',
      },
    })
    const row = await buildRowForEvent(db, 'a', 'reservation.updated', { reservation_id: 'r2' }, 'Ventas')
    expect(row!.tab).toBe('Ventas - Eventos')
    expect(row!.header).toContain('Salón')
    expect(row!.header).toContain('Decoración')
    expect(row!.values.at(-1)).toBe('Aprobado')
    expect(row!.values.slice(1)).toEqual(['Boda', 'Beto', '502222', '2026-05-01', 80, 'Salón Jardín', 'Rústica', 15000, 'Aprobado'])
  })

  it('returns null for reservation.updated when the reservation is gone', async () => {
    const row = await buildRowForEvent(makeDb({ reservation: null }), 'a', 'reservation.updated', { reservation_id: 'x' }, 'Ventas')
    expect(row).toBeNull()
  })
})
