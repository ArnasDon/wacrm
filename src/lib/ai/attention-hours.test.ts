import { describe, it, expect } from 'vitest'
import { isAfterHours, withAttentionHours } from './attention-hours'
import { isGiftVoucherAsk } from './hotel-media-intent'
import { classifyRecentAgentRows } from './human-reply'

describe('hotel meeting 2026-10-09', () => {
  it('after hours = 8 pm to 7 am, Guatemala time', () => {
    const gt = (h: number) => new Date(Date.UTC(2026, 9, 9, h + 6, 15))
    expect(isAfterHours(gt(20), 'America/Guatemala')).toBe(true)
    expect(isAfterHours(gt(6), 'America/Guatemala')).toBe(true)
    expect(isAfterHours(gt(7), 'America/Guatemala')).toBe(false)
    expect(isAfterHours(gt(19), 'America/Guatemala')).toBe(false)
  })
  it('rewrites team promises with the real time frame', () => {
    expect(withAttentionHours('Un compañero le confirmará la disponibilidad en breve. 😊', false))
      .toBe('Un compañero le confirmará la disponibilidad. Le darán seguimiento en un máximo de una hora. 😊')
    expect(withAttentionHours('El hotel le estará confirmando los métodos de pago en breve, en un máximo de 20 minutos.', true))
      .toBe('El hotel le estará confirmando los métodos de pago. Nuestro horario de atención es de 8:00 am a 8:00 pm; en ese horario le darán seguimiento.')
    expect(withAttentionHours('Con mucho gusto, un compañero de nuestro equipo le atenderá por este chat. 🙌', true, true))
      .toBe('Con mucho gusto, un compañero de nuestro equipo le atenderá por este chat. Nuestro horario de atención es de 8:00 am a 8:00 pm; en ese horario le darán seguimiento. 🙌')
    // VSR 2026-10-10: the model already stated the time frame — never a second one.
    const own = '¡Con mucho gusto! Un compañero del área de reservaciones le ayudará con eso en un máximo de una hora. 😊'
    expect(withAttentionHours(own, false, true)).toBe(own)
    expect(withAttentionHours('Nuestro horario de atención es de 8:00 am a 8:00 pm; en ese horario le confirmarán los métodos de pago.', true, true)).toContain('horario de atención')
    const plain = 'La Suite Clásica cuesta Q600 por noche. ¿Para qué fechas?'
    expect(withAttentionHours(plain, false)).toBe(plain)
  })
  it('gift voucher asks, not every "vale"', () => {
    for (const t of ['Tengo un vale especial', 'quiero usar mi tarjeta de regalo', 'Tengo un cupón con ustedes un voucher!', 'me regalaron un certificado de regalo'])
      expect(isGiftVoucherAsk(t), t).toBe(true)
    for (const t of ['¿Cuánto vale la suite?', 'Vale, gracias', 'vale la pena?']) expect(isGiftVoucherAsk(t), t).toBe(false)
  })
  it('a fast canned greeting is only a possible echo; a slower reply is a person', () => {
    const rows = [
      { sender_type: 'customer', content_text: 'hola', created_at: '2026-10-09T18:00:00Z' },
      { sender_type: 'agent', content_text: 'Gracias por su mensaje.', created_at: '2026-10-09T18:00:03Z' },
    ]
    expect(classifyRecentAgentRows(rows, '2026-10-09T17:00:00Z')).toEqual({ humanReply: false, possibleEchoes: ['Gracias por su mensaje.'] })
    expect(classifyRecentAgentRows([...rows, { sender_type: 'agent', content_text: 'Con gusto, ¿cuántas personas?', created_at: '2026-10-09T18:01:00Z' }], '2026-10-09T17:00:00Z').humanReply).toBe(true)
    // Before the window → ignored.
    expect(classifyRecentAgentRows([{ sender_type: 'agent', content_text: 'ok', created_at: '2026-10-09T10:00:00Z' }], '2026-10-09T17:00:00Z').humanReply).toBe(false)
  })
})
