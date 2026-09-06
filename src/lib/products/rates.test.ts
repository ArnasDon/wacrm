import { describe, it, expect } from 'vitest'
import {
  weekdayGroupOf,
  nightsBetween,
  resolveNightlyRate,
  quoteStay,
  parseRates,
  type ProductRate,
} from './rates'

describe('weekdayGroupOf', () => {
  it('Mon–Thu are weekday, Fri–Sun are weekend', () => {
    // 2026-03-02 is a Monday
    expect(weekdayGroupOf('2026-03-02')).toBe('weekday') // Mon
    expect(weekdayGroupOf('2026-03-03')).toBe('weekday') // Tue
    expect(weekdayGroupOf('2026-03-04')).toBe('weekday') // Wed
    expect(weekdayGroupOf('2026-03-05')).toBe('weekday') // Thu
    expect(weekdayGroupOf('2026-03-06')).toBe('weekend') // Fri
    expect(weekdayGroupOf('2026-03-07')).toBe('weekend') // Sat
    expect(weekdayGroupOf('2026-03-08')).toBe('weekend') // Sun
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

const RATES: ProductRate[] = [
  { weekday_group: 'weekday', occupancy: 'standard', price: 800, date_from: null, date_to: null },
  { weekday_group: 'weekend', occupancy: 'standard', price: 1200, date_from: null, date_to: null },
  { weekday_group: 'weekday', occupancy: 'couple', price: 950, date_from: null, date_to: null },
  { weekday_group: 'weekend', occupancy: 'couple', price: 1400, date_from: null, date_to: null },
]

describe('resolveNightlyRate', () => {
  it('picks the right group + occupancy', () => {
    expect(resolveNightlyRate(RATES, '2026-03-05', 'standard')).toBe(800) // Thu
    expect(resolveNightlyRate(RATES, '2026-03-06', 'standard')).toBe(1200) // Fri
    expect(resolveNightlyRate(RATES, '2026-03-05', 'couple')).toBe(950)
    expect(resolveNightlyRate(RATES, '2026-03-07', 'couple')).toBe(1400) // Sat
  })

  it('a couple stay falls back to the standard rate when no couple rate is set', () => {
    const noCouple = RATES.filter((r) => r.occupancy === 'standard')
    expect(resolveNightlyRate(noCouple, '2026-03-06', 'couple')).toBe(1200)
  })

  it('a seasonal override wins for nights inside its range', () => {
    const withHoliday: ProductRate[] = [
      ...RATES,
      { weekday_group: 'weekday', occupancy: 'standard', price: 1500, date_from: '2026-12-24', date_to: '2026-12-31' },
    ]
    expect(resolveNightlyRate(withHoliday, '2026-12-24', 'standard')).toBe(1500) // Thu, in season
    expect(resolveNightlyRate(withHoliday, '2026-03-05', 'standard')).toBe(800) // Thu, out of season
  })

  it('returns null when nothing matches', () => {
    expect(resolveNightlyRate([], '2026-03-05', 'standard')).toBeNull()
    const weekendOnly = RATES.filter((r) => r.weekday_group === 'weekend')
    expect(resolveNightlyRate(weekendOnly, '2026-03-05', 'standard')).toBeNull() // Thu, no weekday rate
  })
})

describe('quoteStay', () => {
  it('sums a Thu–Sun stay across weekday + weekend', () => {
    // Thu(800) + Fri(1200) + Sat(1200) = 3200
    const q = quoteStay(RATES, '2026-03-05', '2026-03-08', 'standard')
    expect(q.total).toBe(3200)
    expect(q.nights.map((n) => n.price)).toEqual([800, 1200, 1200])
    expect(q.nights.map((n) => n.weekday_group)).toEqual(['weekday', 'weekend', 'weekend'])
    expect(q.missing).toEqual([])
  })

  it('flags nights with no rate and still sums the rest', () => {
    const weekendOnly = RATES.filter((r) => r.weekday_group === 'weekend')
    const q = quoteStay(weekendOnly, '2026-03-05', '2026-03-08', 'standard')
    expect(q.missing).toEqual(['2026-03-05']) // Thu
    expect(q.total).toBe(2400) // Fri + Sat only
  })

  it('empty for a bad range', () => {
    expect(quoteStay(RATES, '2026-03-08', '2026-03-05').nights).toEqual([])
  })
})

describe('parseRates', () => {
  it('accepts a well-formed payload and assigns positions', () => {
    const res = parseRates([
      { weekday_group: 'weekday', price: '800' },
      { weekday_group: 'weekend', occupancy: 'couple', price: 1400 },
      { weekday_group: 'weekday', occupancy: 'standard', price: 1500, date_from: '2026-12-24', date_to: '2026-12-31' },
    ])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rates).toHaveLength(3)
    expect(res.rates[0]).toMatchObject({ weekday_group: 'weekday', occupancy: 'standard', price: 800, position: 0 })
    expect(res.rates[2]).toMatchObject({ date_from: '2026-12-24', date_to: '2026-12-31', position: 2 })
  })

  it('undefined / null → no rates', () => {
    expect(parseRates(undefined)).toEqual({ ok: true, rates: [] })
    expect(parseRates(null)).toEqual({ ok: true, rates: [] })
  })

  it('rejects a bad group / occupancy / price', () => {
    expect(parseRates([{ weekday_group: 'friday', price: 1 }]).ok).toBe(false)
    expect(parseRates([{ weekday_group: 'weekday', occupancy: 'trio', price: 1 }]).ok).toBe(false)
    expect(parseRates([{ weekday_group: 'weekday', price: -5 }]).ok).toBe(false)
    expect(parseRates([{ weekday_group: 'weekday', price: 'abc' }]).ok).toBe(false)
  })

  it('requires both dates or neither, and date_to >= date_from', () => {
    expect(parseRates([{ weekday_group: 'weekday', price: 1, date_from: '2026-12-24' }]).ok).toBe(false)
    expect(
      parseRates([{ weekday_group: 'weekday', price: 1, date_from: '2026-12-31', date_to: '2026-12-24' }]).ok,
    ).toBe(false)
    expect(parseRates([{ weekday_group: 'weekday', price: 1, date_from: 'xx', date_to: 'yy' }]).ok).toBe(false)
  })

  it('caps the number of rates', () => {
    const many = Array.from({ length: 13 }, () => ({ weekday_group: 'weekday' as const, price: 1 }))
    expect(parseRates(many).ok).toBe(false)
  })

  it('rejects a non-array', () => {
    expect(parseRates({ weekday_group: 'weekday' }).ok).toBe(false)
  })
})
