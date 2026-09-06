// ============================================================
// Per-date room rates for the `hotel` industry vertical (migration
// 106). Pure — no I/O, fully unit-tested. Shared by:
//   - POST/PATCH /api/products        (validation: parseRates)
//   - the quote builder               (quoteStay)
//   - src/lib/ai/catalog-context.ts   (rate structure shown to the AI)
//
// The rule Villa San Ricardo asked for: Mon–Thu ("weekday") is cheaper
// than Fri–Sun ("weekend"); a couple rate can differ from the standard
// rate; an optional date range gives a seasonal override that wins for
// the nights inside it.
// ============================================================

export type WeekdayGroup = 'weekday' | 'weekend'
export type Occupancy = 'standard' | 'couple'

/** A row of `product_rates`, request-body or DB shape (only the fields
 *  the resolver needs). */
export interface ProductRate {
  weekday_group: WeekdayGroup
  occupancy: Occupancy
  price: number
  /** ISO `YYYY-MM-DD`. Both null = the always-on rate; both set = a
   *  seasonal override for `[date_from, date_to]` inclusive. */
  date_from: string | null
  date_to: string | null
}

export const MAX_PRODUCT_RATES = 12 // 2 groups × 2 occupancies × up to 3 seasons

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Fri / Sat / Sun are the weekend; Mon–Thu the weekday. */
export function weekdayGroupOf(dateISO: string): WeekdayGroup {
  const day = new Date(`${dateISO}T12:00:00Z`).getUTCDay() // 0 = Sun … 6 = Sat
  return day === 0 || day === 5 || day === 6 ? 'weekend' : 'weekday'
}

/**
 * The nights of a stay as ISO dates — check-in inclusive, check-out
 * exclusive (you don't pay for the night you leave). Returns `[]` for a
 * malformed or non-positive range.
 */
export function nightsBetween(checkInISO: string, checkOutISO: string): string[] {
  if (!ISO_DATE.test(checkInISO) || !ISO_DATE.test(checkOutISO)) return []
  const start = new Date(`${checkInISO}T12:00:00Z`)
  const end = new Date(`${checkOutISO}T12:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
  if (end.getTime() <= start.getTime()) return []

  const out: string[] = []
  const cursor = new Date(start)
  // Cap to a sane stay length so a bad input can't spin.
  for (let i = 0; i < 366 && cursor.getTime() < end.getTime(); i += 1) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function seasonContains(rate: ProductRate, nightISO: string): boolean {
  if (!rate.date_from || !rate.date_to) return false
  return nightISO >= rate.date_from && nightISO <= rate.date_to
}

/**
 * The price for one night, given all of a product's rates.
 *
 * Resolution order:
 *   1. exact occupancy + weekday group, seasonal row covering the night
 *   2. exact occupancy + weekday group, always-on row
 *   3. (occupancy 'couple' only) fall back to the 'standard' rate for
 *      the same group — a couple rate is optional
 *
 * Returns `null` when nothing matches (the caller surfaces it as a gap).
 */
export function resolveNightlyRate(
  rates: ProductRate[],
  nightISO: string,
  occupancy: Occupancy,
): number | null {
  const group = weekdayGroupOf(nightISO)
  const tryOccupancy = (occ: Occupancy): number | null => {
    const forGroup = rates.filter((r) => r.weekday_group === group && r.occupancy === occ)
    const seasonal = forGroup.find((r) => seasonContains(r, nightISO))
    if (seasonal) return seasonal.price
    const always = forGroup.find((r) => !r.date_from && !r.date_to)
    return always ? always.price : null
  }

  const exact = tryOccupancy(occupancy)
  if (exact !== null) return exact
  if (occupancy === 'couple') return tryOccupancy('standard')
  return null
}

export interface StayNight {
  date: string
  weekday_group: WeekdayGroup
  price: number | null
}

export interface StayQuote {
  nights: StayNight[]
  /** Sum of the priced nights only. */
  total: number
  /** ISO dates with no resolvable rate — a human must price these. */
  missing: string[]
}

/** Price a whole stay night-by-night. */
export function quoteStay(
  rates: ProductRate[],
  checkInISO: string,
  checkOutISO: string,
  occupancy: Occupancy = 'standard',
): StayQuote {
  const nights = nightsBetween(checkInISO, checkOutISO).map((date): StayNight => {
    const price = resolveNightlyRate(rates, date, occupancy)
    return { date, weekday_group: weekdayGroupOf(date), price }
  })
  const total = nights.reduce((sum, n) => sum + (n.price ?? 0), 0)
  const missing = nights.filter((n) => n.price === null).map((n) => n.date)
  return { nights, total, missing }
}

/**
 * One-line human summary of a product's always-on rates (seasonal rows
 * are ignored — they add noise in a catalog listing). `fmt` formats a
 * money amount (so callers control currency/locale). Empty string when
 * there are no always-on rates.
 *
 * e.g. "Lun–Jue Q800 · Vie–Dom Q1200 · pareja Lun–Jue Q950"
 */
export function summarizeRates(
  rates: Pick<ProductRate, 'weekday_group' | 'occupancy' | 'price' | 'date_from' | 'date_to'>[],
  fmt: (amount: number) => string,
): string {
  const always = rates.filter((r) => !r.date_from && !r.date_to)
  if (always.length === 0) return ''
  return always
    .slice()
    .sort(
      (a, b) =>
        Number(a.occupancy === 'couple') - Number(b.occupancy === 'couple') ||
        Number(a.weekday_group === 'weekend') - Number(b.weekday_group === 'weekend'),
    )
    .map(
      (r) =>
        `${r.occupancy === 'couple' ? 'pareja ' : ''}${r.weekday_group === 'weekend' ? 'Vie–Dom' : 'Lun–Jue'} ${fmt(r.price)}`,
    )
    .join(' · ')
}

// ------------------------------------------------------------
// Request-body validation — sibling of parsePriceOptions in
// price-options.ts. Used by POST /api/products and PATCH /api/products/[id].
// ------------------------------------------------------------

export interface ParsedRate {
  weekday_group: WeekdayGroup
  occupancy: Occupancy
  price: number
  date_from: string | null
  date_to: string | null
  position: number
}

export type ParseRatesResult =
  | { ok: true; rates: ParsedRate[] }
  | { ok: false; error: string }

export function parseRates(raw: unknown): ParseRatesResult {
  if (raw === undefined || raw === null) return { ok: true, rates: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'rates must be an array' }
  if (raw.length > MAX_PRODUCT_RATES) {
    return { ok: false, error: `A product may have at most ${MAX_PRODUCT_RATES} rates` }
  }

  const rates: ParsedRate[] = []
  for (const [i, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: `rates[${i}] must be an object` }
    }
    const row = entry as Record<string, unknown>

    const group = row.weekday_group
    if (group !== 'weekday' && group !== 'weekend') {
      return { ok: false, error: `rates[${i}].weekday_group must be 'weekday' or 'weekend'` }
    }
    const occupancy = row.occupancy ?? 'standard'
    if (occupancy !== 'standard' && occupancy !== 'couple') {
      return { ok: false, error: `rates[${i}].occupancy must be 'standard' or 'couple'` }
    }
    const price = Number(row.price)
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: `rates[${i}].price must be a non-negative number` }
    }

    const from = row.date_from
    const to = row.date_to
    const fromSet = typeof from === 'string' && from.trim() !== ''
    const toSet = typeof to === 'string' && to.trim() !== ''
    if (fromSet !== toSet) {
      return { ok: false, error: `rates[${i}] must set both date_from and date_to, or neither` }
    }
    let dateFrom: string | null = null
    let dateTo: string | null = null
    if (fromSet && toSet) {
      if (!ISO_DATE.test(from as string) || !ISO_DATE.test(to as string)) {
        return { ok: false, error: `rates[${i}] dates must be YYYY-MM-DD` }
      }
      if ((to as string) < (from as string)) {
        return { ok: false, error: `rates[${i}].date_to must not be before date_from` }
      }
      dateFrom = from as string
      dateTo = to as string
    }

    rates.push({
      weekday_group: group,
      occupancy,
      price,
      date_from: dateFrom,
      date_to: dateTo,
      position: rates.length,
    })
  }

  return { ok: true, rates }
}
