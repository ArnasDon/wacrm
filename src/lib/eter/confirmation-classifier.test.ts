import { describe, it, expect } from 'vitest'
import { classifyConfirmationDeterministic, normalizeConfirmationText } from './confirmation-classifier'

describe('normalizeConfirmationText', () => {
  it('strips accents, lowercases, and trims punctuation', () => {
    expect(normalizeConfirmationText('Está bem!')).toBe('esta bem')
    expect(normalizeConfirmationText('  SIM.  ')).toBe('sim')
    expect(normalizeConfirmationText('Não, obrigado')).toBe('nao, obrigado')
  })

  it('collapses internal whitespace runs', () => {
    expect(normalizeConfirmationText('sim   por    favor')).toBe('sim por favor')
  })
})

describe('classifyConfirmationDeterministic — confirmations', () => {
  const confirmations = [
    'sim',
    'Sim',
    'SIM',
    'confirmo',
    'ok',
    'esta bem',
    'está bem',
    'pode ser',
    'combinado',
    'perfeito',
    'claro',
    'sim por favor',
    'sim!',
    'sim.',
    'sim,',
    '  sim  ',
    'Está bem!',
  ]

  for (const text of confirmations) {
    it(`classifies "${text}" as confirm`, () => {
      expect(classifyConfirmationDeterministic(text)).toBe('confirm')
    })
  }
})

describe('classifyConfirmationDeterministic — refusals', () => {
  const refusals = [
    'nao',
    'não',
    'Não',
    'nao pode',
    'não pode',
    'cancela',
    'deixa estar',
    'outro dia',
    'mais tarde',
    'não!',
    '  nao  ',
  ]

  for (const text of refusals) {
    it(`classifies "${text}" as reject`, () => {
      expect(classifyConfirmationDeterministic(text)).toBe('reject')
    })
  }
})

describe('classifyConfirmationDeterministic — must NOT match (falls through to other)', () => {
  const ambiguous = [
    'sim, mas pode ser noutro dia?',
    'talvez',
    'não sei',
    'ok vou pensar',
    'quero saber mais sobre isso',
    'que horas',
    'pode ser amanhã de manhã?',
    '',
    'boa tarde',
    'sim sim sim mas depois confirmo',
  ]

  for (const text of ambiguous) {
    it(`classifies "${text}" as other`, () => {
      expect(classifyConfirmationDeterministic(text)).toBe('other')
    })
  }
})
