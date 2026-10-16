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
  it('includeRetired drops the is_active_build filter and tags retired rows (handoff recap)', async () => {
    const eqCalls: [string, unknown][] = []
    const rows = [
      { category: 'paquetes', service_name: 'Paquete Romántico', guests: 2, check_in: '2026-12-20', check_out: '2026-12-21', use_date: null, duration_minutes: null, hall: null, estimated_price: null, is_active_build: false },
      { category: 'paquetes', service_name: 'Paquete Romántico', guests: 2, check_in: '2026-10-10', check_out: '2026-10-11', use_date: null, duration_minutes: null, hall: null, estimated_price: null, is_active_build: true },
    ]
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return chain },
      order: () => chain,
      then: (resolve: (r: unknown) => unknown) => resolve({ data: rows, error: null }),
    }
    const db = { from: () => chain } as unknown as SupabaseClient
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ', undefined, { includeRetired: true })
    expect(eqCalls.map(([c]) => c)).not.toContain('is_active_build')
    expect(res.current).toBe(
      '- Paquete: Paquete Romántico · 20/12/2026 → 21/12/2026 · 2 personas · solicitud anterior, sigue pendiente\n' +
        '- Paquete: Paquete Romántico · 10/10/2026 → 11/10/2026 · 2 personas',
    )

    eqCalls.length = 0
    await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')
    expect(eqCalls).toContainEqual(['is_active_build', true])
  })

  it('returns null in both buckets when there are no active requests', async () => {
    const db = makeDb({ reservation_requests: { rows: [] } })
    expect(await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')).toEqual({
      current: null,
      stale: null,
    })
  })

  it('formats a stay-dates row (DD/MM/AAAA) with guests and the estimated price', async () => {
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
    expect(res.stale).toBeNull()
    expect(res.current).toMatch(/^- Habitación: Suite Premium · 18\/09\/2026 → 19\/09\/2026 · 2 personas · estimado .*920/)
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
    expect(res.current).toBe('- Spa: Masaje relajante · 13/09/2026 · 1 persona · 60 min')
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
    expect(res.current).toBe(
      '- Evento: evento religioso · 20/09/2026 · 30 personas · salón\n' +
        '- Actividad: cabalgata · 11/09/2026 · 5 personas',
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
    expect(res.current).not.toContain('estimado')
  })

  it('without todayISO, every pending row comes back as current (old behavior, the handoff-recap caller)', async () => {
    const db = makeDb({
      reservation_requests: {
        rows: [
          {
            category: 'habitaciones',
            service_name: 'Suite Premium',
            guests: 2,
            check_in: '2020-01-01',
            check_out: '2020-01-03',
            use_date: null,
            duration_minutes: null,
            hall: null,
            estimated_price: null,
          },
        ],
      },
    })
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')
    expect(res.stale).toBeNull()
    expect(res.current).toContain('Suite Premium')
  })

  it('moves a pending request whose check_out already passed into the stale bucket', async () => {
    const db = makeDb({
      reservation_requests: {
        rows: [
          {
            category: 'habitaciones',
            service_name: 'Suite Premium',
            guests: 2,
            check_in: '2026-09-01',
            check_out: '2026-09-03',
            use_date: null,
            duration_minutes: null,
            hall: null,
            estimated_price: null,
          },
        ],
      },
    })
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ', '2026-09-21')
    expect(res.current).toBeNull()
    expect(res.stale).toBe('- Habitación: Suite Premium · 01/09/2026 → 03/09/2026 · 2 personas')
  })

  it('keeps a pending request whose date is today or in the future out of the stale bucket', async () => {
    const db = makeDb({
      reservation_requests: {
        rows: [
          { category: 'spa', service_name: 'Masaje', guests: 1, check_in: null, check_out: null, use_date: '2026-09-21', duration_minutes: 50, hall: null, estimated_price: null },
          { category: 'eventos', service_name: 'Boda', guests: 80, check_in: null, check_out: null, use_date: '2026-10-01', duration_minutes: null, hall: 'Jardín', estimated_price: null },
        ],
      },
    })
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ', '2026-09-21')
    expect(res.stale).toBeNull()
    expect(res.current).toContain('Masaje')
    expect(res.current).toContain('Boda')
  })

  it('a request with no date yet is never stale, regardless of todayISO', async () => {
    const db = makeDb({
      reservation_requests: {
        rows: [
          { category: 'habitaciones', service_name: 'Suite Premium', guests: 2, check_in: null, check_out: null, use_date: null, duration_minutes: null, hall: null, estimated_price: null },
        ],
      },
    })
    const res = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ', '2026-09-21')
    expect(res.stale).toBeNull()
    expect(res.current).toContain('Suite Premium')
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


it.each([null, []])('never describes an incomplete five-person party as child-free: %j', async (children_ages) => {
  const db = makeDb({ reservation_requests: { rows: [{ category: 'habitaciones', service_name: 'Junior Suite Familiar', guests: 5, adults: 4, children_ages, notes: '1 niño de 5 años' }] } })
  const summary = await loadActiveReservationsSummary(db, 'acct-1', 'cv-1', 'GTQ')
  expect(summary.current).not.toContain('sin niños')
  expect(summary.current).toContain('edades de niños pendientes')
})
