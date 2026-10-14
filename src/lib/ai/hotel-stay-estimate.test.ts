import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadHotelStayEstimate, computeStayEstimateStatus, isEnglishText } from './hotel-stay-estimate'

// 2026-09-09 is a Wednesday. Couple rate Mon–Thu = 500, Fri–Sun = 700.
const RATES = [
  { day_of_week: 'wed', occupancy: 'couple', price: 500, date_from: null, date_to: null },
  { day_of_week: 'thu', occupancy: 'couple', price: 500, date_from: null, date_to: null },
  { day_of_week: 'fri', occupancy: 'couple', price: 700, date_from: null, date_to: null },
  { day_of_week: 'wed', occupancy: 'standard', price: 300, date_from: null, date_to: null },
]

interface Opts {
  reservation?: Record<string, unknown> | null
  rates?: unknown[]
  products?: { id: string; name: string }[]
  updates?: { id: string; patch: Record<string, unknown> }[]
}

function makeDb(o: Opts) {
  o.updates ??= []
  const db = {
    from(table: string) {
      const result =
        table === 'product_rates'
          ? { data: o.rates ?? [], error: null }
          : table === 'products'
            ? { data: o.products ?? [], error: null }
            : { data: null, error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: o.reservation ?? null, error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => ({
            is: () => {
              o.updates!.push({ id, patch })
              return Promise.resolve({ error: null })
            },
          }),
        }),
        then: (resolve: (r: unknown) => unknown) => resolve(result),
      }
      return chain
    },
  }
  return db as unknown as SupabaseClient
}

const RESV = {
  id: 'rr-1',
  category: 'habitaciones',
  service_name: 'Master Suite Deluxe',
  product_id: null,
  guests: 2,
  check_in: '2026-09-09',
  check_out: '2026-09-10',
  estimated_price: null,
}

describe('loadHotelStayEstimate', () => {
  it('does not quote an unavailable explicit product', async () => {
    expect(await loadHotelStayEstimate(makeDb({ reservation: { ...RESV, product_id: 'inactive' },
      rates: RATES, products: [],
    }), 'acct-1', 'cv-1', 'GTQ')).toBeNull()
  })
  it('does not invent guests or pick an ambiguous room', async () => {
    for (const reservation of [{ ...RESV, guests: null }, { ...RESV, service_name: 'Suite' }]) {
      expect(await loadHotelStayEstimate(makeDb({ reservation, rates: RATES, products: [
        { id: 'p1', name: 'Master Suite Deluxe' }, { id: 'p2', name: 'Suite Familiar' },
      ] }), 'acct-1', 'cv-1', 'GTQ')).toBeNull()
    }
  })
  it('computes a 1-night couple stay from the published tariffs', async () => {
    const res = await loadHotelStayEstimate(
      makeDb({ reservation: RESV, rates: RATES, products: [{ id: 'p1', name: 'Master Suite Deluxe' }] }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toBeTruthy()
    expect(res).toContain('Master Suite Deluxe')
    expect(res).toContain('1 noche')
    expect(res).toMatch(/Total estimado: .*500/)
    expect(res).toContain('estimado')
  })

  it('does not request a deposit for a complete but still pending stay', async () => {
    const res = await loadHotelStayEstimate(
      makeDb({ reservation: RESV, rates: RATES, products: [{ id: 'p1', name: 'Master Suite Deluxe' }] }),
      'acct-1',
      'cv-1',
      'GTQ',
      50,
    )
    expect(res).not.toContain('anticipo')
    expect(res).toContain('la disponibilidad y el precio final los confirma una persona')
  })

  it('does not request a deposit even when a different percentage is configured', async () => {
    const res = await loadHotelStayEstimate(
      makeDb({ reservation: RESV, rates: RATES, products: [{ id: 'p1', name: 'Master Suite Deluxe' }] }),
      'acct-1',
      'cv-1',
      'GTQ',
      30,
    )
    expect(res).not.toContain('anticipo')
    expect(res).toMatch(/Total estimado: .*500/)
  })

  it('does NOT mention a deposit when a night has no published rate (partial subtotal)', async () => {
    const res = await loadHotelStayEstimate(
      makeDb({
        reservation: { ...RESV, check_out: '2026-09-13' },
        rates: RATES,
        products: [{ id: 'p1', name: 'Master Suite Deluxe' }],
      }),
      'acct-1',
      'cv-1',
      'GTQ',
      50,
    )
    expect(res).not.toContain('anticipo')
  })

  it('back-fills reservation_requests.estimated_price when every night priced', async () => {
    const updates: { id: string; patch: Record<string, unknown> }[] = []
    await loadHotelStayEstimate(
      makeDb({ reservation: RESV, rates: RATES, products: [{ id: 'p1', name: 'Master Suite Deluxe' }], updates }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(updates).toEqual([{ id: 'rr-1', patch: { estimated_price: 500 } }])
  })

  it('does NOT back-fill when a night has no published rate', async () => {
    const updates: { id: string; patch: Record<string, unknown> }[] = []
    const res = await loadHotelStayEstimate(
      makeDb({
        reservation: { ...RESV, check_out: '2026-09-13' }, // 09,10,11,12; sat (09-12) has no couple/standard rate
        rates: RATES,
        products: [{ id: 'p1', name: 'Master Suite Deluxe' }],
        updates,
      }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toContain('sin tarifa publicada')
    expect(res).toContain('Subtotal de noches con tarifa')
    expect(res).not.toContain('Total estimado:')
    expect(updates).toEqual([])
  })

  it('returns null with no pending reservation row', async () => {
    expect(await loadHotelStayEstimate(makeDb({ reservation: null }), 'acct-1', 'cv-1', 'GTQ')).toBeNull()
  })

  it('returns null when the product has no rates', async () => {
    const res = await loadHotelStayEstimate(
      makeDb({ reservation: RESV, rates: [], products: [{ id: 'p1', name: 'Master Suite Deluxe' }] }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toBeNull()
  })

  it("returns null when service_name matches no product", async () => {
    const res = await loadHotelStayEstimate(
      makeDb({ reservation: RESV, rates: RATES, products: [{ id: 'p1', name: 'Cabaña del Bosque' }] }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toBeNull()
  })
})

// Real incident, 2026-09-20: a guest's Suite Clásica (Wed check-in, Thu
// check-out — both nights the CORPORATE rate) got quoted Q800 instead of
// the real Q1,200 (Q600 × 2), because the model's servicio="Suite Clásica"
// matched TWO real products ambiguously and the model then supplied its
// own guessed `precio` instead of leaving pricing to the system.
// `computeStayEstimateStatus` is the fix's other half: a discriminated
// status the caller (auto-reply.ts) can act on — proactively send on
// 'priced', alert an owner on 'unpriceable', stay quiet otherwise.
function makeDb2(o: Opts) {
  o.updates ??= []
  const db = {
    from(table: string) {
      const result =
        table === 'product_rates'
          ? { data: o.rates ?? [], error: null }
          : table === 'products'
            ? { data: o.products ?? [], error: null }
            : { data: null, error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: o.reservation ?? null, error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            o.updates!.push({ id, patch })
            return Promise.resolve({ error: null })
          },
        }),
        then: (resolve: (r: unknown) => unknown) => resolve(result),
      }
      return chain
    },
  }
  return db as unknown as SupabaseClient
}

describe('computeStayEstimateStatus', () => {
  it('returns unpriceable/no_product_match on an ambiguous service_name — the real 2026-09-20 bug', async () => {
    const res = await computeStayEstimateStatus(
      makeDb2({
        reservation: { ...RESV, service_name: 'Suite Clásica' },
        rates: RATES,
        products: [
          { id: 'p1', name: 'Suite Clásica (Individual o Pareja)' },
          { id: 'p2', name: 'Suite Clásica Doble' },
        ],
      }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toEqual({ status: 'unpriceable', reason: 'no_product_match' })
  })

  it('is incomplete (no alert) while the guest has not picked a room yet', async () => {
    const res = await computeStayEstimateStatus(
      makeDb2({ reservation: { ...RESV, service_name: null, product_id: null }, rates: RATES, products: [] }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toEqual({ status: 'incomplete' })
  })

  it('computes the correct mixed-rate total and text when the name resolves cleanly', async () => {
    // check_in Wed, check_out Fri (exclusive) = Wed(500) + Thu(500) = 1000.
    const res = await computeStayEstimateStatus(
      makeDb2({
        reservation: { ...RESV, check_out: '2026-09-11', service_name: 'Master Suite Deluxe' },
        rates: RATES,
        products: [{ id: 'p1', name: 'Master Suite Deluxe' }],
      }),
      'acct-1',
      'cv-1',
      'GTQ',
      50,
    )
    expect(res.status).toBe('priced')
    if (res.status === 'priced') {
      expect(res.total).toBe(1000)
      expect(res.text).toContain('1,000')
      expect(res.text).toContain('Master Suite Deluxe')
      for (const text of [res.text, res.closingText]) {
        expect(text).not.toContain('anticipo')
        expect(text).not.toContain('en breve')
      }
      for (const text of [res.textEn, res.closingTextEn]) expect(text).not.toContain('deposit')
      expect(res.text).toContain('no confirma una reserva')
      expect(res.reservationRequestId).toBe('rr-1')
    }
  })

  it('presents a multi-night package as an estimate the team confirms (QA 2026-10-01)', async () => {
    const res = await computeStayEstimateStatus(
      makeDb2({
        reservation: { ...RESV, category: 'paquetes', check_out: '2026-09-11', service_name: 'Master Suite Deluxe' },
        rates: RATES,
        products: [{ id: 'p1', name: 'Master Suite Deluxe' }],
      }),
      'acct-1',
      'cv-1',
      'GTQ',
      50,
    )
    expect(res.status).toBe('priced')
    if (res.status === 'priced') {
      expect(res.closingText).toContain('Es un estimado: el precio de la noche adicional del paquete')
      expect(res.text).toContain('noche adicional')
    }
  })

  it('returns incomplete without dates or guests', async () => {
    expect(
      await computeStayEstimateStatus(makeDb2({ reservation: null }), 'acct-1', 'cv-1', 'GTQ'),
    ).toEqual({ status: 'incomplete' })
    expect(
      await computeStayEstimateStatus(
        makeDb2({ reservation: { ...RESV, guests: null } }),
        'acct-1',
        'cv-1',
        'GTQ',
      ),
    ).toEqual({ status: 'incomplete' })
  })

  it('returns too_large_group for 5+ guests — never auto-priced, by design', async () => {
    const res = await computeStayEstimateStatus(
      makeDb2({ reservation: { ...RESV, guests: 6 }, rates: RATES, products: [{ id: 'p1', name: 'Master Suite Deluxe' }] }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toEqual({ status: 'too_large_group' })
  })

  it('returns unpriceable/no_rates when the product has no published rates', async () => {
    const res = await computeStayEstimateStatus(
      makeDb2({ reservation: RESV, rates: [], products: [{ id: 'p1', name: 'Master Suite Deluxe' }] }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toEqual({ status: 'unpriceable', reason: 'no_rates' })
  })

  it('returns unpriceable/missing_night_rate (never a silent partial total) when a night has no published rate', async () => {
    const res = await computeStayEstimateStatus(
      makeDb2({
        reservation: { ...RESV, check_out: '2026-09-13' }, // includes Sat, which has no couple/standard rate
        rates: RATES,
        products: [{ id: 'p1', name: 'Master Suite Deluxe' }],
      }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(res).toEqual({ status: 'unpriceable', reason: 'missing_night_rate' })
  })

  it('backfills reservation_requests.estimated_price with the correct total, overwriting a stale/wrong one', async () => {
    const updates: { id: string; patch: Record<string, unknown> }[] = []
    await computeStayEstimateStatus(
      makeDb2({
        // Simulates the bug: a wrong model-guessed price already stored.
        reservation: { ...RESV, check_out: '2026-09-11', estimated_price: 800 },
        rates: RATES,
        products: [{ id: 'p1', name: 'Master Suite Deluxe' }],
        updates,
      }),
      'acct-1',
      'cv-1',
      'GTQ',
    )
    expect(updates).toEqual([{ id: 'rr-1', patch: { estimated_price: 1000 } }])
  })
})

describe('several rooms (B43)', () => {
  const PRODUCTS = [{ id: 'p1', name: 'Master Suite Deluxe' }]
  it('prices every room at its per-room occupancy', async () => {
    const res = await computeStayEstimateStatus(
      makeDb({ reservation: { ...RESV, guests: 4, rooms: 2 }, rates: RATES, products: PRODUCTS }),
      'acct-1', 'cv-1', 'GTQ',
    )
    expect(res.status).toBe('priced')
    if (res.status !== 'priced') return
    expect(res.total).toBe(1000) // 2 rooms × couple Wed 500
    expect(res.text).toContain('2 habitaciones × 2 personas')
    // The after-close wording: no item/dates recap, one availability line.
    expect(res.closingText).toMatch(/^El total estimado de su solicitud es de .*1.?000 por 1 noche \(2 habitaciones × 2 personas\)\. Recepción debe verificar la disponibilidad; este estimado no confirma una reserva\.$/)
    expect(res.closingText).not.toContain('Master Suite Deluxe')
    const summary = await loadHotelStayEstimate(
      makeDb({ reservation: { ...RESV, guests: 4, rooms: 2 }, rates: RATES, products: PRODUCTS }),
      'acct-1', 'cv-1', 'GTQ',
    )
    expect(summary).toMatch(/Total estimado \(2 habitaciones\): .*1.?000/)
  })
  it('leaves an uneven split to a person', async () => {
    const res = await computeStayEstimateStatus(
      makeDb({ reservation: { ...RESV, guests: 5, rooms: 2 }, rates: RATES, products: PRODUCTS }),
      'acct-1', 'cv-1', 'GTQ',
    )
    expect(res.status).toBe('uneven_rooms')
  })
})

describe('partial estimate over capacity (owner, 2026-09-26)', () => {
  const JUNIOR_RATES = [
    { day_of_week: 'thu', occupancy: 'quad', price: 1160, date_from: null, date_to: null },
    { day_of_week: 'fri', occupancy: 'quad', price: 1500, date_from: null, date_to: null },
    { day_of_week: 'thu', occupancy: 'child', price: 175, date_from: null, date_to: null },
    { day_of_week: 'fri', occupancy: 'child', price: 200, date_from: null, date_to: null },
  ]
  it('4 adults + a child + a baby in a 5-person room: quotes, and says the team validates', async () => {
    const res = await computeStayEstimateStatus(
      makeDb({
        // `max_guests` rides on the same maybeSingle the mock returns for every table.
        reservation: {
          ...RESV, service_name: 'Master Suite Deluxe', guests: 6, adults: 4, children_ages: [8, 2],
          check_in: '2026-11-12', check_out: '2026-11-14', max_guests: 5,
        },
        rates: JUNIOR_RATES,
        products: [{ id: 'p1', name: 'Master Suite Deluxe' }],
      }),
      'acct-1', 'cv-1', 'GTQ',
    )
    expect(res.status).toBe('priced')
    if (res.status !== 'priced') return
    expect(res.total).toBe(1160 + 175 + 1500 + 200)
    expect(res.closingText).toContain('(4 adultos y 2 niños; los menores de 6 años no pagan)')
    expect(res.closingText).not.toMatch(/\([^)]*\(/) // never nested parentheses
    expect(res.closingText).not.toMatch(/\) \(/) // never two in a row
    expect(res.closingText).toContain('Es un estimado: como son 6 personas, el equipo validará la disponibilidad y el precio final.')
    expect(res.text).toContain('Como son 6 personas, el equipo validará la disponibilidad y el precio final.')
  })
})

describe('partial estimate wording — one parenthesis (owner, 2026-09-26)', () => {
  const RATES_J = [
    { day_of_week: 'thu', occupancy: 'couple', price: 600, date_from: null, date_to: null },
    { day_of_week: 'fri', occupancy: 'couple', price: 800, date_from: null, date_to: null },
    { day_of_week: 'thu', occupancy: 'quad', price: 1160, date_from: null, date_to: null },
    { day_of_week: 'fri', occupancy: 'quad', price: 1500, date_from: null, date_to: null },
    { day_of_week: 'thu', occupancy: 'child', price: 175, date_from: null, date_to: null },
    { day_of_week: 'fri', occupancy: 'child', price: 200, date_from: null, date_to: null },
  ]
  const run = (party: Record<string, unknown>) =>
    computeStayEstimateStatus(
      makeDb({
        reservation: { ...RESV, check_in: '2026-11-12', check_out: '2026-11-14', max_guests: 5, ...party },
        rates: RATES_J,
        products: [{ id: 'p1', name: 'Master Suite Deluxe' }],
      }),
      'acct-1', 'cv-1', 'GTQ',
    )

  it('5 adults', async () => {
    const res = await run({ guests: 5, adults: 5, children_ages: [] })
    expect(res.status === 'priced' && res.closingText).toContain(
      'por 2 noches (5 adultos; calculado con la tarifa publicada de 4 personas).',
    )
  })

  it('1 adult + 4 children', async () => {
    const res = await run({ guests: 5, adults: 1, children_ages: [7, 9, 10, 12] })
    expect(res.status === 'priced' && res.total).toBe(600 + 700 + 800 + 800)
    expect(res.status === 'priced' && res.closingText).toContain(
      '(1 adulto y 4 niños; calculado con la tarifa de pareja, la mínima de la habitación)',
    )
    expect(res.status === 'priced' && res.text).toContain('(calculado con la tarifa de pareja, la mínima de la habitación)')
  })
})

describe('isEnglishText', () => {
  it('tells English replies from Spanish ones', () => {
    expect(isEnglishText("Thank you, John. I've noted 2 guests for the Suite Master Deluxe. Check-in is from 3:00 pm.")).toBe(true)
    expect(isEnglishText('Queda solicitada su Suite Premium para 2 personas; el check-in es a partir de las 3:00 pm.')).toBe(false)
    expect(isEnglishText('')).toBe(false)
  })
})
