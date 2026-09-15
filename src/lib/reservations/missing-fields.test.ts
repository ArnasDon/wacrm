import { describe, expect, it } from 'vitest'
import { missingReservationFields, reservationFollowUpText } from './missing-fields'

describe('missingReservationFields', () => {
  it('a room/package with no dates or guests needs both', () => {
    expect(missingReservationFields({ category: 'habitaciones' })).toEqual([
      'las fechas de entrada y salida',
      'el número de personas',
    ])
    expect(missingReservationFields({ category: 'paquetes' })).toEqual([
      'las fechas de entrada y salida',
      'el número de personas',
    ])
  })

  it('a room with both dates and guests needs nothing', () => {
    expect(
      missingReservationFields({
        category: 'habitaciones',
        check_in: '2026-10-01',
        check_out: '2026-10-03',
        guests: 2,
      }),
    ).toEqual([])
  })

  it('a room with only one side of the date range still needs dates', () => {
    expect(
      missingReservationFields({ category: 'habitaciones', check_in: '2026-10-01', guests: 2 }),
    ).toEqual(['las fechas de entrada y salida'])
  })

  it('spa/actividades need a single use_date, not a range', () => {
    expect(missingReservationFields({ category: 'spa' })).toEqual([
      'la fecha',
      'el número de personas',
    ])
    expect(
      missingReservationFields({ category: 'actividades', use_date: '2026-10-01', guests: 4 }),
    ).toEqual([])
  })

  it('eventos additionally needs the hall', () => {
    expect(missingReservationFields({ category: 'eventos' })).toEqual([
      'la fecha',
      'el número de personas',
      'el salón que le interesa',
    ])
    expect(
      missingReservationFields({
        category: 'eventos',
        use_date: '2026-12-01',
        guests: 80,
        hall: 'Salón Jardín',
      }),
    ).toEqual([])
  })
})

describe('reservationFollowUpText', () => {
  it('offers a plain confirmation when nothing is missing', () => {
    expect(reservationFollowUpText([])).toBe(
      '¿Le gustaría confirmar la reservación? Con gusto se la dejamos lista.',
    )
  })

  it('names a single missing field', () => {
    expect(reservationFollowUpText(['el número de personas'])).toBe(
      '¿Le gustaría confirmar la reservación? Me falta el número de personas para dejarla lista.',
    )
  })

  it('joins two missing fields with "y"', () => {
    expect(reservationFollowUpText(['las fechas de entrada y salida', 'el número de personas'])).toBe(
      '¿Le gustaría confirmar la reservación? Me falta las fechas de entrada y salida y el número de personas para dejarla lista.',
    )
  })

  it('joins three+ missing fields with commas and a trailing "y"', () => {
    expect(
      reservationFollowUpText(['la fecha', 'el número de personas', 'el salón que le interesa']),
    ).toBe(
      '¿Le gustaría confirmar la reservación? Me falta la fecha, el número de personas y el salón que le interesa para dejarla lista.',
    )
  })
})
