import { describe, expect, it } from 'vitest'

import { evaluateTransition, missingToMessage } from './state-machine'
import type { DealLike, PipelineStageLike, TimelineEvidence } from './state-machine'

const deal = (overrides: Partial<DealLike> = {}): DealLike => ({
  id: 'd1',
  stage_id: 's_lead',
  status: 'open',
  version: 3,
  ...overrides,
})

const stage = (overrides: Partial<PipelineStageLike> = {}): PipelineStageLike => ({
  id: 's_calificado',
  name: 'Calificado',
  ...overrides,
})

const evidence = (events: string[]): TimelineEvidence[] =>
  events.map((event_type, i) => ({ event_type, deal_id: 'd1', id: `e${i}` } as TimelineEvidence & { id: string }))

describe('evaluateTransition (DAD §7.1)', () => {
  it('ALLOWED sin guard_rules', () => {
    const v = evaluateTransition({ deal: deal(), toStage: stage(), evidence: [] })
    expect(v.allowed).toBe(true)
    expect(v.code).toBe('ALLOWED')
    expect(v.missing).toEqual([])
  })

  it('GUARDS_MISSING cuando falta evidencia requerida (no-bloqueante por defecto)', () => {
    const v = evaluateTransition({
      deal: deal(),
      toStage: stage({ guard_rules: { required_evidence: ['call_logged', 'message_received'] } }),
      evidence: evidence(['call_logged']),
    })
    expect(v.allowed).toBe(false)
    expect(v.code).toBe('GUARDS_MISSING')
    expect(v.missing).toEqual(['message_received'])
  })

  it('HARD_GUARD cuando allow_override=false', () => {
    const v = evaluateTransition({
      deal: deal(),
      toStage: stage({ guard_rules: { required_evidence: ['call_logged'], allow_override: false } }),
      evidence: [],
    })
    expect(v.allowed).toBe(false)
    expect(v.code).toBe('HARD_GUARD')
    expect(v.missing).toEqual(['call_logged'])
  })

  it('ALLOWED con toda la evidencia presente', () => {
    const v = evaluateTransition({
      deal: deal(),
      toStage: stage({ guard_rules: { required_evidence: ['call_logged', 'message_received'] } }),
      evidence: evidence(['call_logged', 'message_received']),
    })
    expect(v.allowed).toBe(true)
    expect(v.missing).toEqual([])
  })

  it('no-op produce warning (mismo stage)', () => {
    const v = evaluateTransition({
      deal: deal({ stage_id: 's_calificado' }),
      toStage: stage(),
      evidence: [],
    })
    expect(v.warnings.some((w) => w.includes('no cambia nada'))).toBe(true)
  })

  it('transición a won con newStatus genera warning de won_at', () => {
    const v = evaluateTransition({
      deal: deal({ stage_id: 's_calificado', status: 'open', won_at: null }),
      toStage: stage({ id: 's_won', name: 'Won' }),
      newStatus: 'won',
      evidence: [],
    })
    expect(v.allowed).toBe(true)
    expect(v.warnings.some((w) => w.includes('won_at'))).toBe(true)
  })

  it('NO_STAGE sin stage destino', () => {
    const v = evaluateTransition({
      deal: deal(),
      toStage: { id: '', name: '' },
      evidence: [],
    })
    expect(v.allowed).toBe(false)
    expect(v.code).toBe('NO_STAGE')
  })
})

describe('missingToMessage', () => {
  it('formatea lista de evidencia faltante', () => {
    expect(missingToMessage(['call_logged', 'message_received'])).toBe('falta evidencia: call logged, message received')
  })
  it('vacío sin items', () => {
    expect(missingToMessage([])).toBe('')
  })
})
