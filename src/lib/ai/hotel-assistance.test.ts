import { describe, expect, it } from 'vitest'
import { shouldDeferHotelStaffFollowup, hasUnconfirmedStayDuration, hotelReceptionReason, hotelCurrentRequest, isHotelReceptionPending } from './hotel-assistance'
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


describe('current topic after a reception handoff', () => {
  const handoffAt = '2026-10-14T15:00:00.000Z'
  it('separates a later informational question from an unanswered cancellation', () => {
    const messages = [ { ...user('Quiero cancelar mi reserva'), createdAt: '2026-10-14T14:59:00.000Z' }, { ...user('¿Tienen parqueo?'), createdAt: '2026-10-14T19:00:00.000Z' } ]
    expect(hotelReceptionReason(hotelCurrentRequest(messages, handoffAt))).toBeNull()
    expect(shouldDeferHotelStaffFollowup(hotelCurrentRequest(messages, handoffAt), true)).toBe(false)
  })
  it('keeps all new messages together so a mixed payment and information burst stays with staff', () => {
    const messages = [ { ...user('Quiero cancelar mi reserva'), createdAt: '2026-10-14T14:59:00.000Z' }, { ...user('Le envío mi comprobante'), createdAt: '2026-10-14T19:00:00.000Z' }, { ...user('¿Tienen parqueo?'), createdAt: '2026-10-14T19:00:10.000Z' } ]
    expect(hotelReceptionReason(hotelCurrentRequest(messages, handoffAt))).toBeTruthy()
  })
  it('does not discard the original pending request when no new message has arrived', () => {
    const messages = [{ ...user('Quiero cancelar mi reserva'), createdAt: '2026-10-14T14:59:00.000Z' }]
    expect(hotelReceptionReason(hotelCurrentRequest(messages, handoffAt))).toBeTruthy()
  })
  it('recognizes only the application pending marker, not a manual pause', () => {
    expect(isHotelReceptionPending('🤝 Pendiente de recepción. Un pago.')).toBe(true)
    expect(isHotelReceptionPending('🤖 Ana tomó el control de esta conversación manualmente y pausó la IA.')).toBe(false)
    expect(isHotelReceptionPending(null)).toBe(false)
  })
})


it('lets a separate later question resume after an unanswered operational follow-up', () => {
  const messages = [
    { ...user('Quiero cancelar mi reserva'), createdAt: '2026-10-14T14:59:00.000Z' },
    { ...user('Le envío el comprobante'), createdAt: '2026-10-14T18:00:00.000Z' },
    { ...user('¿Tienen parqueo?'), createdAt: '2026-10-14T19:00:00.000Z' },
  ]
  expect(hotelReceptionReason(hotelCurrentRequest(messages, '2026-10-14T15:00:00.000Z'))).toBeNull()
})
