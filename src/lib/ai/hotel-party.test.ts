import { describe, expect, it } from 'vitest'
import { repairHotelPartyFields } from './hotel-party'

describe('child ages omitted from the reservation marker', () => {
  it('recovers Mery’s five-year-old from the explicit note, despite ninos=0', () => {
    expect(repairHotelPartyFields({ adultos: '4', personas: '5', ninos: '0', nota: '1 nino de 5 anos' }))
      .toEqual({ adultos: '4', personas: '5', edades_ninos: '5', nota: '1 nino de 5 anos' })
  })
  it('recovers multiple explicitly enumerated ages', () => {
    expect(repairHotelPartyFields({ adultos: '3', personas: '5', nota: '2 niños de 4 y 2 años' }).edades_ninos).toBe('4,2')
  })
  it.each(['2 niños de 5 años', '1 niño de 30 años', 'Cumpleaños el 5, entrada 17/10', 'Sin niños; 1 niño de 5 años en otra habitación'])('does not guess an incomplete or inconsistent party: %s', (nota) => {
    const fields = { adultos: '3', personas: '5', nota }
    expect(repairHotelPartyFields(fields)).toBe(fields)
  })
  it('preserves explicit structured ages instead of overriding them with an old note', () => {
    const fields = { adultos: '4', personas: '5', edades_ninos: '7', nota: '1 niño de 5 años' }
    expect(repairHotelPartyFields(fields)).toBe(fields)
  })
})

it('does not recover ages belonging to another room or a child who no longer travels', () => {
  for (const nota of ['1 nino de 5 anos en otra habitacion', 'No viaja 1 nino de 5 anos', 'Sin ninos; antes 1 nino de 5 anos']) {
    const fields = { adultos: '4', personas: '5', nota }
    expect(repairHotelPartyFields(fields)).toBe(fields)
  }
})
