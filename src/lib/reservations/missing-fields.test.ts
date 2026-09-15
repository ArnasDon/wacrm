import { describe, expect, it } from 'vitest'
import { formatCurrency } from '@/lib/currency'
import {
  missingReservationFields,
  reservationFollowUpText,
  reservationSummaryText,
  buildReservationFollowUpMessage,
} from './missing-fields'

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

describe('reservationSummaryText', () => {
  it('recaps service, dates, guests and price for a complete room booking', () => {
    expect(
      reservationSummaryText(
        {
          category: 'habitaciones',
          service_name: 'Suite Premium',
          check_in: '2026-10-01',
          check_out: '2026-10-03',
          guests: 2,
          estimated_price: 1200,
        },
        'GTQ',
      ),
    ).toBe(
      `Perfecto, esto sería: Suite Premium, del 2026-10-01 al 2026-10-03, 2 personas, total estimado ${formatCurrency(1200, 'GTQ')}. ¿Confirmamos la reservación?`,
    )
  })

  it('recaps a single-use-date category (spa/actividades) without a price on file', () => {
    expect(
      reservationSummaryText(
        { category: 'spa', service_name: 'Masaje relajante', use_date: '2026-10-05', guests: 1 },
        'GTQ',
      ),
    ).toBe('Perfecto, esto sería: Masaje relajante, 2026-10-05, 1 persona. ¿Confirmamos la reservación?')
  })

  it('includes the hall for eventos', () => {
    expect(
      reservationSummaryText(
        {
          category: 'eventos',
          service_name: 'Salón de bodas',
          use_date: '2026-12-01',
          guests: 80,
          hall: 'Salón Jardín',
        },
        'GTQ',
      ),
    ).toBe(
      'Perfecto, esto sería: Salón de bodas, 2026-12-01, 80 personas, Salón Jardín. ¿Confirmamos la reservación?',
    )
  })

  it('falls back to a generic phrase when nothing is on file to recap', () => {
    expect(reservationSummaryText({ category: 'habitaciones' }, 'GTQ')).toBe(
      'Perfecto, esto sería: su reservación. ¿Confirmamos la reservación?',
    )
  })
})

describe('buildReservationFollowUpMessage', () => {
  it('asks for missing fields when the reservation is incomplete', () => {
    expect(buildReservationFollowUpMessage({ category: 'habitaciones' }, 'GTQ')).toBe(
      '¿Le gustaría confirmar la reservación? Me falta las fechas de entrada y salida y el número de personas para dejarla lista.',
    )
  })

  it('gives the full summary once the reservation is complete', () => {
    expect(
      buildReservationFollowUpMessage(
        {
          category: 'habitaciones',
          service_name: 'Suite Premium',
          check_in: '2026-10-01',
          check_out: '2026-10-03',
          guests: 2,
        },
        'GTQ',
      ),
    ).toBe('Perfecto, esto sería: Suite Premium, del 2026-10-01 al 2026-10-03, 2 personas. ¿Confirmamos la reservación?')
  })
})
