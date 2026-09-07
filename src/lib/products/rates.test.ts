import { describe, it, expect } from 'vitest'
import {
  dayOfWeekOf,
  nightsBetween,
  resolveNightlyRate,
  quoteStay,
  parseRates,
  summarizeRates,
  occupancyForGuests,
  type ProductRate,
} from './rates'

describe('dayOfWeekOf', () => {
  it('maps ISO dates to day-of-week codes', () => {
    // 2026-03-02 is a Monday
    expect(dayOfWeekOf('2026-03-02')).toBe('mon')
    expect(dayOfWeekOf('2026-03-03')).toBe('tue')
    expect(dayOfWeekOf('2026-03-04')).toBe('wed')
    expect(dayOfWeekOf('2026-03-05')).toBe('thu')
    expect(dayOfWeekOf('2026-03-06')).toBe('fri')
    expect(dayOfWeekOf('2026-03-07')).toBe('sat')
    expect(dayOfWeekOf('2026-03-08')).toBe('sun')
  })
})

describe('occupancyForGuests', () => {
  it('1 → standard, 2 → couple, 3+ → group', () => {
    expect(occupancyForGuests(1)).toBe('standard')
    expect(occupancyForGuests(2)).toBe('couple')
    expect(occupancyForGuests(3)).toBe('group')
    expect(occupancyForGuests(9)).toBe('group')
    expect(occupancyForGuests(0)).toBe('standard')
  })
})

describe('nightsBetween', () => {
  it('check-in inclusive, check-out exclusive', () => {
    expect(nightsBetween('2026-03-05', '2026-03-08')).toEqual([
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
    ])
  })

  it('one night', () => {
    expect(nightsBetween('2026-03-05', '2026-03-06')).toEqual(['2026-03-05'])
  })

  it('rejects a non-positive or malformed range', () => {
    expect(nightsBetween('2026-03-08', '2026-03-05')).toEqual([])
    expect(nightsBetween('2026-03-05', '2026-03-05')).toEqual([])
    expect(nightsBetween('not-a-date', '2026-03-06')).toEqual([])
  })

  it('crosses a month boundary correctly', () => {
    expect(nightsBetween('2026-03-30', '2026-04-02')).toEqual([
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
    ])
  })
})

// Thu = 700, Fri = 1000, Sat = 1200 (standard); couple set for Thu + Fri only.
const RATES: ProductRate[] = [
  { day_of_week: 'thu', occupancy: 'standard', price: 700, date_from: null, date_to: null },
  { day_of_week: 'fri', occupancy: 'standard', price: 1000, date_from: null, date_to: null },
  { day_of_week: 'sat', occupancy: 'standard', price: 1200, date_from: null, date_to: null },
  { day_of_week: 'thu', occupancy: 'couple', price: 850, date_from: null, date_to: null },
  { day_of_week: 'fri', occupancy: 'couple', price: 1150, date_from: null, date_to: null },
]

describe('resolveNightlyRate', () => {
  it('picks the exact day + occupancy', () => {
    expect(resolveNightlyRate(RATES, '2026-03-05', 'standard')).toBe(700) // Thu
    expect(resolveNightlyRate(RATES, '2026-03-06', 'standard')).toBe(1000) // Fri
    expect(resolveNightlyRate(RATES, '2026-03-07', 'standard')).toBe(1200) // Sat
    expect(resolveNightlyRate(RATES, '2026-03-05', 'couple')).toBe(850)
  })

  it('a couple stay falls back to the standard rate for that day', () => {
    // Sat has no couple rate → standard 1200
    expect(resolveNightlyRate(RATES, '2026-03-07', 'couple')).toBe(1200)
  })

  it('uses an explicit group (3+) rate, and falls back to standard when absent', () => {
    const withGroup: ProductRate[] = [
      ...RATES,
      { day_of_week: 'thu', occupancy: 'group', price: 1100, date_from: null, date_to: null },
    ]
    expect(resolveNightlyRate(withGroup, '2026-03-05', 'group')).toBe(1100) // Thu, explicit
    expect(resolveNightlyRate(withGroup, '2026-03-06', 'group')).toBe(1000) // Fri, no group → standard
    // group never borrows the couple rate
    expect(resolveNightlyRate(RATES, '2026-03-05', 'group')).toBe(700)
  })

  it('a seasonal override wins for nights inside its range', () => {
    const withHoliday: ProductRate[] = [
      ...RATES,
      { day_of_week: 'thu', occupancy: 'standard', price: 2000, date_from: '2026-12-24', date_to: '2026-12-31' },
    ]
    expect(resolveNightlyRate(withHoliday, '2026-12-24', 'standard')).toBe(2000) // Thu, in season
    expect(resolveNightlyRate(withHoliday, '2026-03-05', 'standard')).toBe(700) // Thu, out of season
  })

  it('returns null when the day has no rate', () => {
    expect(resolveNightlyRate([], '2026-03-05', 'standard')).toBeNull()
    expect(resolveNightlyRate(RATES, '2026-03-02', 'standard')).toBeNull() // Mon, unpriced
  })
})

describe('quoteStay', () => {
  it('sums a Thu–Sun stay day by day', () => {
    // Thu(700) + Fri(1000) + Sat(1200) = 2900
    const q = quoteStay(RATES, '2026-03-05', '2026-03-08', 'standard')
    expect(q.total).toBe(2900)
    expect(q.nights.map((n) => n.price)).toEqual([700, 1000, 1200])
    expect(q.nights.map((n) => n.day_of_week)).toEqual(['thu', 'fri', 'sat'])
    expect(q.missing).toEqual([])
  })

  it('flags nights with no rate and still sums the rest', () => {
    // Wed(none) + Thu(700) + Fri(1000)
    const q = quoteStay(RATES, '2026-03-04', '2026-03-07', 'standard')
    expect(q.missing).toEqual(['2026-03-04']) // Wed
    expect(q.total).toBe(1700)
  })

  it('empty for a bad range', () => {
    expect(quoteStay(RATES, '2026-03-08', '2026-03-05').nights).toEqual([])
  })
})

describe('summarizeRates', () => {
  const fmt = (n: number) => `Q${n}`

  it('collapses same-priced consecutive days into a range', () => {
    const rates: ProductRate[] = [
      { day_of_week: 'mon', occupancy: 'standard', price: 800, date_from: null, date_to: null },
      { day_of_week: 'tue', occupancy: 'standard', price: 800, date_from: null, date_to: null },
      { day_of_week: 'wed', occupancy: 'standard', price: 800, date_from: null, date_to: null },
      { day_of_week: 'thu', occupancy: 'standard', price: 800, date_from: null, date_to: null },
      { day_of_week: 'fri', occupancy: 'standard', price: 1000, date_from: null, date_to: null },
      { day_of_week: 'sat', occupancy: 'standard', price: 1200, date_from: null, date_to: null },
      { day_of_week: 'sun', occupancy: 'standard', price: 1200, date_from: null, date_to: null },
    ]
    expect(summarizeRates(rates, fmt)).toBe('Lun–Jue Q800 · Vie Q1000 · Sáb–Dom Q1200')
  })

  it('orders standard → couple → group and prefixes the tier', () => {
    const rates: ProductRate[] = [
      { day_of_week: 'fri', occupancy: 'standard', price: 1000, date_from: null, date_to: null },
      { day_of_week: 'fri', occupancy: 'couple', price: 1200, date_from: null, date_to: null },
      { day_of_week: 'fri', occupancy: 'group', price: 1600, date_from: null, date_to: null },
    ]
    expect(summarizeRates(rates, fmt)).toBe('Vie Q1000 · pareja Vie Q1200 · grupo Vie Q1600')
  })

  it('ignores seasonal rows', () => {
    const rates: ProductRate[] = [
      { day_of_week: 'thu', occupancy: 'standard', price: 700, date_from: null, date_to: null },
      { day_of_week: 'thu', occupancy: 'standard', price: 2000, date_from: '2026-12-24', date_to: '2026-12-31' },
    ]
    expect(summarizeRates(rates, fmt)).toBe('Jue Q700')
  })

  it('empty when there are no always-on rates', () => {
    expect(summarizeRates([], fmt)).toBe('')
  })

  it('ignores a 0 / negative price (blank cell), not a free night', () => {
    const rates: ProductRate[] = [
      { day_of_week: 'mon', occupancy: 'standard', price: 300, date_from: null, date_to: null },
      { day_of_week: 'mon', occupancy: 'group', price: 0, date_from: null, date_to: null },
    ]
    expect(summarizeRates(rates, fmt)).toBe('Lun Q300')
  })
})

describe('parseRates', () => {
  it('accepts a well-formed payload and assigns positions', () => {
    const res = parseRates([
      { day_of_week: 'mon', price: '800' },
      { day_of_week: 'fri', occupancy: 'couple', price: 1400 },
      { day_of_week: 'thu', occupancy: 'standard', price: 1500, date_from: '2026-12-24', date_to: '2026-12-31' },
    ])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rates).toHaveLength(3)
    expect(res.rates[0]).toMatchObject({ day_of_week: 'mon', occupancy: 'standard', price: 800, position: 0 })
    expect(res.rates[2]).toMatchObject({ date_from: '2026-12-24', date_to: '2026-12-31', position: 2 })
  })

  it('undefined / null → no rates', () => {
    expect(parseRates(undefined)).toEqual({ ok: true, rates: [] })
    expect(parseRates(null)).toEqual({ ok: true, rates: [] })
  })

  it('rejects a bad day / occupancy / price', () => {
    expect(parseRates([{ day_of_week: 'friday', price: 1 }]).ok).toBe(false)
    expect(parseRates([{ day_of_week: 'weekday', price: 1 }]).ok).toBe(false)
    expect(parseRates([{ day_of_week: 'mon', occupancy: 'trio', price: 1 }]).ok).toBe(false)
    expect(parseRates([{ day_of_week: 'mon', price: -5 }]).ok).toBe(false)
    expect(parseRates([{ day_of_week: 'mon', price: 'abc' }]).ok).toBe(false)
  })

  it("accepts occupancy 'group'", () => {
    const res = parseRates([{ day_of_week: 'sat', occupancy: 'group', price: 1600 }])
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.rates[0]).toMatchObject({ occupancy: 'group', price: 1600 })
  })

  it('requires both dates or neither, and date_to >= date_from', () => {
    expect(parseRates([{ day_of_week: 'mon', price: 1, date_from: '2026-12-24' }]).ok).toBe(false)
    expect(
      parseRates([{ day_of_week: 'mon', price: 1, date_from: '2026-12-31', date_to: '2026-12-24' }]).ok,
    ).toBe(false)
    expect(parseRates([{ day_of_week: 'mon', price: 1, date_from: 'xx', date_to: 'yy' }]).ok).toBe(false)
  })

  it('caps the number of rates', () => {
    const many = Array.from({ length: 64 }, () => ({ day_of_week: 'mon' as const, price: 1 }))
    expect(parseRates(many).ok).toBe(false)
  })

  it('rejects a non-array', () => {
    expect(parseRates({ day_of_week: 'mon' }).ok).toBe(false)
  })
})
