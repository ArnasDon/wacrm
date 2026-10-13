import { describe, it, expect } from 'vitest'
import { answersByKey, FORM_VERTICALS, formSections, publicFormSpec, CODE_TITLE } from './spec'
import { buildOnboardingOutput, mergePromptBlock, PROMPT_BLOCK_END, PROMPT_BLOCK_START } from './apply'
import { intakeLink, TOKEN_PLACEHOLDER } from './links'

describe('spec', () => {
  it.each(FORM_VERTICALS)('%s: keys and titles are unique (answers map back by title)', (v) => {
    const qs = formSections(v).flatMap((s) => s.questions)
    expect(new Set(qs.map((q) => q.key)).size).toBe(qs.length)
    expect(new Set([...qs.map((q) => q.title), CODE_TITLE]).size).toBe(qs.length + 1)
    for (const q of qs) {
      if (q.type === 'choice' || q.type === 'checkbox') expect(q.options?.length).toBeGreaterThan(1)
      if (q.target === 'prompt') expect(q.promptLine).toBeTypeOf('function')
    }
  })

  it('public spec is plain JSON with hour options filled in', () => {
    const spec = publicFormSpec('hotel')
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec)
    const hour = spec.sections.flatMap((s) => s.questions).find((q) => q.type === 'hour')
    expect(hour?.options).toContain('8:00')
  })

  it('maps titles to keys, joins checkboxes and drops blanks', () => {
    expect(
      answersByKey('hotel', {
        'Nombre comercial': ' Villa Test ',
        'Formas de pago que aceptas': ['Efectivo', 'Tarjeta'],
        '¿Qué hace tu negocio?': '   ',
        'Pregunta desconocida': 'x',
      }),
    ).toEqual({ negocio_nombre: 'Villa Test', pago_formas: 'Efectivo, Tarjeta' })
  })

  it('never asks for a bank account number', () => {
    for (const v of FORM_VERTICALS) {
      for (const q of formSections(v).flatMap((s) => s.questions)) {
        expect(q.title.toLowerCase()).not.toContain('número de cuenta')
      }
    }
  })
})

describe('buildOnboardingOutput', () => {
  const answers = {
    negocio_nombre: 'Villa Test',
    negocio_descripcion: 'Hotel de montaña',
    ia_nombre: 'Ana',
    ia_trato: 'De usted',
    equipo_hora_inicio: '8:00',
    equipo_hora_fin: '20:00',
    hotel_precios: 'Suite Q800',
    hotel_checkin: '15:00 / 12:00',
    hotel_eventos: 'Pasan directo al equipo',
  }

  it('puts KB answers in docs, rules in the prompt block, prices only in the report', () => {
    const out = buildOnboardingOutput('hotel', answers)
    const ficha = out.docs.find((d) => d.title.startsWith('Ficha del negocio'))
    expect(ficha?.content).toContain('Hotel de montaña')
    expect(out.docs.some((d) => d.content.includes('Q800'))).toBe(false)
    expect(out.promptBlock).toContain('Te presentas como Ana.')
    expect(out.promptBlock).toContain('directo al equipo')
    expect(out.promptBlock).toContain('de 8:00 a 20:00')
    expect(out.windowStartHour).toBe(8)
    expect(out.windowEndHour).toBe(20)
    expect(out.manual.some((m) => m.detail === 'Suite Q800')).toBe(true)
    expect(out.missing).toContain('Políticas del hotel: Política de cancelación')
  })

  it('maps the comercio catalog choice to a delivery mode', () => {
    expect(buildOnboardingOutput('comercio', { comercio_envio_catalogo: 'PDF' }).catalogDeliveryMode).toBe('pdf')
  })
})

describe('mergePromptBlock', () => {
  const block = `${PROMPT_BLOCK_START}\n- nueva\n${PROMPT_BLOCK_END}`

  it('creates scaffold + block on an empty prompt', () => {
    expect(mergePromptBlock('  ', block, 'BASE')).toEqual({ prompt: `BASE\n\n${block}`, mode: 'created' })
  })

  it('replaces a previous block in place', () => {
    const current = `Antes\n${PROMPT_BLOCK_START}\n- vieja\n${PROMPT_BLOCK_END}\nDespués`
    expect(mergePromptBlock(current, block, 'BASE')).toEqual({ prompt: `Antes\n${block}\nDespués`, mode: 'replaced' })
  })

  it('leaves a hand-written prompt alone', () => {
    expect(mergePromptBlock('Prompt de VSR', block, 'BASE')).toBeNull()
  })
})

it('intakeLink swaps the placeholder for the token', () => {
  expect(intakeLink(`https://docs.google.com/forms/d/e/x/viewform?entry.1=${TOKEN_PLACEHOLDER}`, 'abc')).toBe(
    'https://docs.google.com/forms/d/e/x/viewform?entry.1=abc',
  )
})
