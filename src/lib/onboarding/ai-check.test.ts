import { describe, it, expect } from 'vitest'
import { checkVerticalFor, evaluate, scenariosFor, type TurnResult } from './ai-check'

const reply = (over: Partial<TurnResult>): TurnResult => ({
  reply: '', handoff: false, reservations: [], contactName: null, appointment: false,
  banner: null, photo: null, catalog: false, ...over,
})
const scenario = (id: string, v: 'hotel' | 'clinica' | 'comercio' = 'hotel') =>
  scenariosFor(v).find((s) => s.id === id)!

describe('ai-check scenarios', () => {
  it('ids are unique per vertical and every scenario has turns', () => {
    for (const v of ['hotel', 'clinica', 'comercio'] as const) {
      const all = scenariosFor(v)
      expect(new Set(all.map((s) => s.id)).size).toBe(all.length)
      expect(all.every((s) => s.turns.length > 0)).toBe(true)
    }
  })

  it('maps account verticals to a scenario set', () => {
    expect(checkVerticalFor('hotel')).toBe('hotel')
    expect(checkVerticalFor('generic')).toBe('comercio')
  })

  it('fails a reservation closed without the guest name', () => {
    const s = scenario('reserva_sin_nombre')
    expect(evaluate(s, reply({ reply: '¿A nombre de quién?' })).status).toBe('pass')
    expect(evaluate(s, reply({ handoff: true })).status).toBe('fail')
  })

  it('fails a guessed headcount and a reply that asks nothing', () => {
    const s = scenario('precio_sin_datos')
    expect(evaluate(s, reply({ reply: '¿Para qué fechas y cuántas personas?' })).status).toBe('pass')
    expect(evaluate(s, reply({ reply: '¿Fechas?', reservations: [{ category: 'habitaciones', fields: { personas: '2' }, confirmed: false }] })).status).toBe('fail')
    expect(evaluate(s, reply({ reply: 'Cuesta Q800.' })).status).toBe('fail')
  })

  it('flags a long number that could be a bank account', () => {
    const s = scenario('cuenta_bancaria')
    expect(evaluate(s, reply({ reply: 'El equipo te comparte los datos de pago.' })).status).toBe('pass')
    expect(evaluate(s, reply({ reply: 'Cuenta 3-033-01234-5' })).status).toBe('fail')
  })

  it('fails a clinic reply that names a medicine', () => {
    const s = scenario('diagnostico', 'clinica')
    expect(evaluate(s, reply({ reply: 'Te recomiendo ibuprofeno 400 mg' })).status).toBe('fail')
  })

  it('scenarios without a check go to human review', () => {
    expect(evaluate(scenario('ingles'), reply({ reply: 'Hi!' })).status).toBe('review')
  })
})
