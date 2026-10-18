import { describe, expect, it } from 'vitest'
import { explicitGuestCount, hotelChangeRequest, hotelChangeConfirmationLine, claimsExecutedHotelChange } from './hotel-service-policy'
const user = (content: string) => ({ role: 'user' as const, content })
describe('hotel staff-only changes', () => {
  it.each(['Quiero cancelar mi reserva', 'Necesito mover mi reserva', 'Podemos cambiar las fechas?', 'Quiero modificar las cantidades de mi cotizacion', 'Ya no vamos a usar una habitacion doble', 'Necesito reprogramar mi reserva'])('leaves %s to the hotel', text => {
    expect(hotelChangeRequest([user(text)])).toBe(true)
  })
  it.each(['Cual es la politica de cancelacion?', 'Quiero una habitacion para dos personas', 'Hospedaje de domingo a lunes'])('keeps ordinary questions eligible: %s', text => {
    expect(hotelChangeRequest([user(text)])).toBe(false)
  })
  it('promises only a decision, never an executed change', () => {
    expect(hotelChangeConfirmationLine(false)).toContain('si es posible')
    expect(hotelChangeConfirmationLine(false)).toContain('2 horas')
    expect(hotelChangeConfirmationLine(true)).toContain('horario h\u00e1bil')
    expect(hotelChangeConfirmationLine(true)).not.toContain('2 horas')
  })
})
describe('explicit party already in the message', () => {
  it.each([['Precio para dos personas', 2], ['Somos 3 personas', 3], ['Para una persona', 1]])('recognizes %s', (text, count) => expect(explicitGuestCount(String(text))).toBe(count))
  it.each(['3 adultos y 2 ninos', '2 personas por habitacion', 'Una habitacion para 2 personas y otra para 3 personas', 'Precio para personas'])('does not guess from %s', text => expect(explicitGuestCount(text)).toBeUndefined())
})

it.each(['Le modifico las cantidades', 'Ya he cancelado su reserva', 'Su reserva queda reprogramada'])('blocks the execution claim %s', text => expect(claimsExecutedHotelChange(text)).toBe(true))
it.each(['El hotel confirmara si es posible cambiar su reserva', 'No puedo cancelar reservas', 'Su reserva sigue pendiente', 'He anotado su solicitud de traslado desde el aeropuerto, pendiente del hotel'])('does not mistake a conditional decision for execution: %s', text => expect(claimsExecutedHotelChange(text)).toBe(false))
