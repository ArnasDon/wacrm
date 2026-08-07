import { describe, it, expect } from 'vitest'
import { validateBusinessHours, BusinessHoursError } from './business-hours'

describe('validateBusinessHours', () => {
  it('accepts null/undefined as "no hours set" (empty object)', () => {
    expect(validateBusinessHours(null)).toEqual({})
    expect(validateBusinessHours(undefined)).toEqual({})
  })

  it('accepts a valid multi-window, multi-day schedule', () => {
    const input = {
      mon: [
        ['09:00', '13:00'],
        ['14:00', '19:00'],
      ],
      fri: [['09:00', '12:00']],
    }
    expect(validateBusinessHours(input)).toEqual(input)
  })

  it('treats a missing weekday as closed (not in the object at all)', () => {
    expect(validateBusinessHours({ mon: [['09:00', '13:00']] })).toEqual({
      mon: [['09:00', '13:00']],
    })
  })

  it('rejects a non-object value', () => {
    expect(() => validateBusinessHours('nope')).toThrow(BusinessHoursError)
    expect(() => validateBusinessHours(42)).toThrow(BusinessHoursError)
    expect(() => validateBusinessHours(['mon'])).toThrow(BusinessHoursError)
  })

  it('rejects an unknown weekday key', () => {
    expect(() => validateBusinessHours({ someday: [] })).toThrow(/unknown day key/)
  })

  it('rejects a malformed time string', () => {
    expect(() => validateBusinessHours({ mon: [['9:00', '13:00']] })).toThrow(BusinessHoursError)
    expect(() => validateBusinessHours({ mon: [['09:00', '25:00']] })).toThrow(BusinessHoursError)
    expect(() => validateBusinessHours({ mon: [['09:00', '13:60']] })).toThrow(BusinessHoursError)
  })

  it('rejects a window whose end is before or equal to its start', () => {
    expect(() => validateBusinessHours({ mon: [['13:00', '09:00']] })).toThrow(/ends before/)
    expect(() => validateBusinessHours({ mon: [['09:00', '09:00']] })).toThrow(/ends before/)
  })

  it('rejects overlapping or out-of-order windows on the same day', () => {
    expect(() =>
      validateBusinessHours({
        mon: [
          ['14:00', '19:00'],
          ['09:00', '13:00'],
        ],
      }),
    ).toThrow(/overlapping or out-of-order/)
    expect(() =>
      validateBusinessHours({
        mon: [
          ['09:00', '14:00'],
          ['13:00', '19:00'],
        ],
      }),
    ).toThrow(/overlapping or out-of-order/)
  })

  it('rejects a window that is not a 2-tuple', () => {
    expect(() => validateBusinessHours({ mon: [['09:00']] })).toThrow(BusinessHoursError)
    expect(() => validateBusinessHours({ mon: [['09:00', '13:00', '15:00']] })).toThrow(BusinessHoursError)
  })
})
