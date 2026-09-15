import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadActiveReservationsSummary, loadKnownContactFacts } from './known-context'

interface TableConfig {
  rows?: unknown[]
  single?: unknown
}

function makeDb(tables: Record<string, TableConfig>) {
  const db = {
    from(table: string) {
      const cfg = tables[table] ?? {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: cfg.single ?? null, error: null }),
        then: (resolve: (r: unknown) => unknown) => resolve({ data: cfg.rows ?? [], error: null }),
      }
      return chain
    },
  }
  return db as unknown as SupabaseClient
}

describe('loadActiveReservationsSummary', () => {
  it('returns null when there are no active requests', async () => {
    const db = makeDb({ reservation_requests: { rows: [] } })
    expect(await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')).toBeNull()
  })

  it('formats a stay-dates row with guests and the estimated price', async () => {
    const db = makeDb({
      reservation_requests: {
        rows: [
          {
            category: 'habitaciones',
            service_name: 'Suite Premium',
            guests: 2,
            check_in: '2026-09-18',
            check_out: '2026-09-19',
            use_date: null,
            duration_minutes: null,
            hall: null,
            estimated_price: 920,
          },
        ],
      },
    })
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')
    expect(res).toMatch(/^- Habitación: Suite Premium · 2026-09-18 → 2026-09-19 · 2 personas · estimado .*920/)
  })

  it('formats a use-date row (spa) without a price when none is set', async () => {
    const db = makeDb({
      reservation_requests: {
        rows: [
          {
            category: 'spa',
            service_name: 'Masaje relajante',
            guests: 1,
            check_in: null,
            check_out: null,
            use_date: '2026-09-13',
            duration_minutes: 60,
            hall: null,
            estimated_price: null,
          },
        ],
      },
    })
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')
    expect(res).toBe('- Spa: Masaje relajante · 2026-09-13 · 1 persona · 60 min')
  })

  it('joins multiple open categories on separate lines, one guest can have several at once', async () => {
    const db = makeDb({
      reservation_requests: {
        rows: [
          {
            category: 'eventos',
            service_name: 'evento religioso',
            guests: 30,
            check_in: null,
            check_out: null,
            use_date: '2026-09-20',
            duration_minutes: null,
            hall: 'salón',
            estimated_price: 0,
          },
          {
            category: 'actividades',
            service_name: 'cabalgata',
            guests: 5,
            check_in: null,
            check_out: null,
            use_date: '2026-09-11',
            duration_minutes: null,
            hall: null,
            estimated_price: null,
          },
        ],
      },
    })
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')
    expect(res).toBe(
      '- Evento: evento religioso · 2026-09-20 · 30 personas · salón\n' +
        '- Actividad: cabalgata · 2026-09-11 · 5 personas',
    )
  })

  it('never invents an estimate — a 0 price is omitted, not shown as free', async () => {
    const db = makeDb({
      reservation_requests: {
        rows: [
          {
            category: 'eventos',
            service_name: 'boda',
            guests: 50,
            check_in: null,
            check_out: null,
            use_date: null,
            duration_minutes: null,
            hall: null,
            estimated_price: 0,
          },
        ],
      },
    })
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')
    expect(res).not.toContain('estimado')
  })
})

describe('loadKnownContactFacts', () => {
  it('returns null when there is no name and no filled custom field', async () => {
    const db = makeDb({
      contacts: { single: { name: null } },
      custom_fields: { rows: [] },
      contact_custom_values: { rows: [] },
    })
    expect(await loadKnownContactFacts(db, 'acct-1', 'contact-1')).toBeNull()
  })

  it('includes the saved name', async () => {
    const db = makeDb({
      contacts: { single: { name: 'Ángel' } },
      custom_fields: { rows: [] },
      contact_custom_values: { rows: [] },
    })
    expect(await loadKnownContactFacts(db, 'acct-1', 'contact-1')).toBe('Nombre: Ángel')
  })

  it('joins custom field definitions to this contact\'s values, skipping empty ones', async () => {
    const db = makeDb({
      contacts: { single: { name: 'Ángel' } },
      custom_fields: {
        rows: [
          { id: 'f1', field_name: 'Medidas' },
          { id: 'f2', field_name: 'Material' },
        ],
      },
      contact_custom_values: {
        rows: [
          { custom_field_id: 'f1', value: '2x3m' },
          { custom_field_id: 'f2', value: '   ' }, // blank — must be skipped
        ],
      },
    })
    const res = await loadKnownContactFacts(db, 'acct-1', 'contact-1')
    expect(res).toBe('Nombre: Ángel\nMedidas: 2x3m')
  })

  it('skips a value whose field definition no longer exists', async () => {
    const db = makeDb({
      contacts: { single: { name: null } },
      custom_fields: { rows: [{ id: 'f1', field_name: 'Medidas' }] },
      contact_custom_values: {
        rows: [
          { custom_field_id: 'f1', value: '2x3m' },
          { custom_field_id: 'deleted-field', value: 'orphan' },
        ],
      },
    })
    expect(await loadKnownContactFacts(db, 'acct-1', 'contact-1')).toBe('Medidas: 2x3m')
  })
})
