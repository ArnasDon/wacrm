import { describe, expect, it } from 'vitest'
import {
  clampCooldownDays,
  clampDelayMinutes,
  clampScale,
  normalizeCsatConfigInput,
  parseScoreFromReply,
} from './config'

describe('clampScale', () => {
  it('accepts 3 and 5, defaults everything else to 5', () => {
    expect(clampScale(3)).toBe(3)
    expect(clampScale(5)).toBe(5)
    expect(clampScale('3')).toBe(3)
    expect(clampScale(4)).toBe(5)
    expect(clampScale(0)).toBe(5)
    expect(clampScale('nope')).toBe(5)
  })
})

describe('clampDelayMinutes', () => {
  it('clamps to [0, 20160] and defaults non-numbers to 1440', () => {
    expect(clampDelayMinutes(0)).toBe(0)
    expect(clampDelayMinutes(60)).toBe(60)
    expect(clampDelayMinutes(-5)).toBe(0)
    expect(clampDelayMinutes(99999)).toBe(20_160)
    expect(clampDelayMinutes('abc')).toBe(1440)
  })
})

describe('clampCooldownDays', () => {
  it('clamps to [0, 365] and defaults non-numbers to 30', () => {
    expect(clampCooldownDays(0)).toBe(0)
    expect(clampCooldownDays(400)).toBe(365)
    expect(clampCooldownDays(-1)).toBe(0)
    expect(clampCooldownDays(undefined)).toBe(30)
  })
})

describe('normalizeCsatConfigInput', () => {
  it('rejects enabling without a template', () => {
    const r = normalizeCsatConfigInput({ enabled: true })
    expect(r.ok).toBe(false)
  })

  it('allows saving disabled with nothing filled in', () => {
    const r = normalizeCsatConfigInput({ enabled: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.enabled).toBe(false)
      expect(r.value.template_name).toBeNull()
      expect(r.value.scale).toBe(5)
      expect(r.value.delay_minutes).toBe(1440)
      expect(r.value.cooldown_days).toBe(30)
    }
  })

  it('normalizes a full valid body', () => {
    const r = normalizeCsatConfigInput({
      enabled: true,
      template_name: '  csat_v1  ',
      template_language: ' es ',
      scale: 3,
      delay_minutes: 120,
      cooldown_days: 45,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({
        enabled: true,
        template_name: 'csat_v1',
        template_language: 'es',
        scale: 3,
        delay_minutes: 120,
        cooldown_days: 45,
      })
    }
  })
})

describe('parseScoreFromReply', () => {
  it('reads a bare integer', () => {
    expect(parseScoreFromReply('5', null, 5)).toBe(5)
    expect(parseScoreFromReply(null, '3', 5)).toBe(3)
  })

  it('reads a prefixed button payload', () => {
    expect(parseScoreFromReply('csat_4', null, 5)).toBe(4)
    expect(parseScoreFromReply('rating:2', null, 5)).toBe(2)
    expect(parseScoreFromReply('score-1', 'anything', 5)).toBe(1)
    expect(parseScoreFromReply('calificacion_5', null, 5)).toBe(5)
  })

  it('reads an embedded digit in a label', () => {
    expect(parseScoreFromReply(null, '5 - Excelente', 5)).toBe(5)
    expect(parseScoreFromReply(null, 'Muy bueno (4)', 5)).toBe(4)
  })

  it('counts stars', () => {
    expect(parseScoreFromReply(null, '★★★★★', 5)).toBe(5)
    expect(parseScoreFromReply(null, '⭐⭐⭐', 5)).toBe(3)
  })

  it('honours the scale bound', () => {
    expect(parseScoreFromReply('5', null, 3)).toBeNull()
    expect(parseScoreFromReply('csat_4', null, 3)).toBeNull()
    expect(parseScoreFromReply('3', null, 3)).toBe(3)
  })

  it('returns null when nothing plausible is present', () => {
    expect(parseScoreFromReply(null, null, 5)).toBeNull()
    expect(parseScoreFromReply('', '   ', 5)).toBeNull()
    expect(parseScoreFromReply('menu_open', 'Gracias', 5)).toBeNull()
  })

  it('prefers the reply id over the text', () => {
    expect(parseScoreFromReply('csat_2', '5 stars', 5)).toBe(2)
  })
})
