import { describe, expect, it } from 'vitest'
import { hotelEventTriage, EVENT_TRIAGE_QUESTION, eventFollowupLine } from './hotel-event-triage'
import type { ChatMessage } from './types'
const user = (content: string): ChatMessage => ({ role: 'user', content })
const ask: ChatMessage = { role: 'assistant', content: EVENT_TRIAGE_QUESTION }
describe('event quotation triage', () => {
  it.each(['Quiero informacion de eventos', 'Precios para una boda', 'Tienen salon para cumpleanos?'])('asks the quotation status first: %s', text => {
    expect(hotelEventTriage([user(text)])).toBe('ask')
  })
  it.each(['Tengo una cotizacion', 'Mi cotizacion es 123', 'Esta en curso', 'En proceso', 'Numero: 12345', '12345'])('routes existing quotation: %s', text => {
    expect(hotelEventTriage([user('Evento'), ask, user(text)])).toBe('existing')
  })
  it.each(['Quiero cotizar', 'Deseo una cotizacion nueva', 'Cotizar'])('continues only explicit new quotes: %s', text => {
    expect(hotelEventTriage([user('Boda'), ask, user(text)])).toBe('new')
  })
  it.each(['Si', 'No tengo cotizacion', '50 personas'])('does not assume new from ambiguity: %s', text => {
    expect(hotelEventTriage([user('Evento'), ask, user(text)])).toBe('ask')
  })
  it('retains the new request across intake turns', () => {
    expect(hotelEventTriage([user('Quiero cotizar una boda'), { role: 'assistant', content: 'Para que fecha?' }, user('El 25 para 50 personas')])).toBe('new')
  })
  it('does not treat bot descriptions as customer selections', () => {
    expect(hotelEventTriage([user('Evento'), ask, user('Si')])).toBe('ask')
  })
  it('drops event state when the customer changes topic', () => {
    expect(hotelEventTriage([user('Mi cotizacion de boda'), user('Quiero una habitacion')])).toBe('none')
  })
  it('keeps ordinary lodging out of event triage', () => {
    expect(hotelEventTriage([user('Cotizacion de habitaciones para 51 personas')])).toBe('none')
  })
  it('uses two hours only during the day', () => {
    expect(eventFollowupLine(false)).toContain('2 horas')
    expect(eventFollowupLine(true)).toContain('horario h\u00e1bil')
    expect(eventFollowupLine(true)).not.toContain('2 horas')
  })
})
