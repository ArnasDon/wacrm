import { describe, expect, it } from 'vitest'
import { shouldDeferHotelStaffFollowup, hasUnconfirmedStayDuration, hotelReceptionReason } from './hotel-assistance'
import type { ChatMessage } from './types'
const user = (content: string): ChatMessage => ({ role: 'user', content })
describe('staff-owned hotel conversations', () => {
  it.each(['Mañana cancelado', 'No entiendo…', 'Somos 3 adultos y dos menores de 10 y 3 años', 'Me urge mi cotización, ya llené el formulario', 'Sí por favor', 'Tengo tarifa corporativa', 'Nos envía la cuenta para pagar'])('defers the operational follow-up: %s', (text) => {
    expect(shouldDeferHotelStaffFollowup([user(text)], true)).toBe(true)
  })
  it.each(['¿A qué hora es el desayuno?', '¿Tienen parqueo?', '¿Me envía fotos de la habitación?'])('still answers factual information: %s', (text) => {
    expect(shouldDeferHotelStaffFollowup([user(text)], true)).toBe(false)
  })
  it('allows a new Sunday-to-Monday inquiry when the previous stay is historical', () => {
    expect(shouldDeferHotelStaffFollowup([user('Hola'), user('Tiene disponibilidad en hospedaje de domingo a lunes?')], false)).toBe(false)
  })
  it('does not restart a live request when the guest asks availability', () => {
    expect(shouldDeferHotelStaffFollowup([user('¿Hay habitación para el domingo?')], true)).toBe(true)
  })
})
describe('explicit stay length', () => {
  it('does not infer Fanny’s checkout from her arrival date and guest count', () => {
    expect(hasUnconfirmedStayDuration([user('Estoy interesada en alojamiento para el domingo 18 de octubre'), user('Somos 3 adultos y 2 niños de 4 y 2 años')])).toBe(true)
  })
  it.each(['Hospedaje de domingo a lunes', 'Alojamiento del 18 al 19 de octubre', 'Hospedaje para el domingo 18, una noche', 'Entrada 18 de octubre, salida 19 de octubre'])('accepts explicit length: %s', (text) => {
    expect(hasUnconfirmedStayDuration([user(text)])).toBe(false)
  })
  it('accepts a guest confirmation to an explicit checkout question', () => {
    expect(hasUnconfirmedStayDuration([user('Hospedaje el domingo 18'), { role: 'assistant', content: '¿Entrada el 18 y salida el 19?' }, user('Sí')])).toBe(false)
  })
})

describe('silent reception routing', () => {
  it.each(['Quiero cancelar mi reserva', 'Necesito un reembolso', 'Le envío mi comprobante', 'Me pasa el número de cuenta', 'Tengo un voucher', 'Soy tour operador, tengo tarifa especial', 'Necesito cambiar mi reserva', 'Ya completé el formulario', 'Mi cotización sigue pendiente', 'Cotización para una boda', 'Quiero cotizar para 51 personas', 'Quiero hablar con una persona'])('routes the staff decision without a customer reply: %s', (text) => {
    expect(hotelReceptionReason([user(text)])).toBeTruthy()
  })
  it.each(['¿A qué hora es el desayuno?', '¿Cuál es su política de cancelación?', '¿Qué formas de pago aceptan?', '¿Cuánto vale la habitación?', 'Quiero reservar una habitación para hoy', 'Hospedaje de domingo a lunes', '¿Me manda fotos de la Suite Premium?'])('keeps ordinary information eligible: %s', (text) => {
    expect(hotelReceptionReason([user(text)])).toBeNull()
  })
})
