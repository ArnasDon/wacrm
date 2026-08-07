import { describe, it, expect } from 'vitest'
import {
  computeQualification,
  urgencyFromDimension,
  parseStoredDimensions,
  DIMENSIONS,
  type Dimension,
} from './lead-scoring'

const FULL_FRIO = { necessidade: 0, autoridade: 0, urgencia: 0, enquadramento: 0, dimensao: 0 } as const
const FULL_QUENTE = { necessidade: 2, autoridade: 2, urgencia: 2, enquadramento: 2, dimensao: 2 } as const

describe('computeQualification — per-dimension scoring', () => {
  it('sums all five dimensions when fully answered', () => {
    const result = computeQualification({
      necessidade: 2,
      autoridade: 1,
      urgencia: 2,
      enquadramento: 1,
      dimensao: 0,
    })
    expect(result.score).toBe(6)
    expect(result.isComplete).toBe(true)
    expect(result.missingDimensions).toEqual([])
  })

  it('each dimension contributes independently across its 0/1/2 range', () => {
    for (const dimension of DIMENSIONS) {
      for (const value of [0, 1, 2] as const) {
        const result = computeQualification({ [dimension]: value } as Partial<Record<Dimension, 0 | 1 | 2>>)
        expect(result.score).toBe(value)
      }
    }
  })

  it('does not pad missing dimensions with zero — partial score reflects only what is known', () => {
    const result = computeQualification({ necessidade: 2, autoridade: 2 })
    expect(result.score).toBe(4)
    expect(result.missingDimensions).toEqual(['urgencia', 'enquadramento', 'dimensao'])
    expect(result.isComplete).toBe(false)
  })

  it('empty input has score 0, all dimensions missing, classification frio', () => {
    const result = computeQualification({})
    expect(result.score).toBe(0)
    expect(result.classification).toBe('frio')
    expect(result.missingDimensions).toEqual([...DIMENSIONS])
    expect(result.isComplete).toBe(false)
  })
})

describe('computeQualification — classification boundaries', () => {
  it('score 3 classifies as frio (upper boundary of frio)', () => {
    expect(computeQualification({ necessidade: 2, autoridade: 1 }).score).toBe(3)
    expect(computeQualification({ necessidade: 2, autoridade: 1 }).classification).toBe('frio')
  })

  it('score 4 classifies as morno (lower boundary of morno)', () => {
    expect(computeQualification({ necessidade: 2, autoridade: 2 }).score).toBe(4)
    expect(computeQualification({ necessidade: 2, autoridade: 2 }).classification).toBe('morno')
  })

  it('score 6 classifies as morno (upper boundary of morno)', () => {
    const result = computeQualification({ necessidade: 2, autoridade: 2, urgencia: 2 })
    expect(result.score).toBe(6)
    expect(result.classification).toBe('morno')
  })

  it('score 7 classifies as quente (lower boundary of quente)', () => {
    const result = computeQualification({ necessidade: 2, autoridade: 2, urgencia: 2, enquadramento: 1 })
    expect(result.score).toBe(7)
    expect(result.classification).toBe('quente')
  })

  it('score 0 (all-zero, fully answered) is frio, score 10 (all-two) is quente', () => {
    expect(computeQualification(FULL_FRIO).classification).toBe('frio')
    expect(computeQualification(FULL_QUENTE).classification).toBe('quente')
  })
})

describe('computeQualification — urgent flag (notify_admin override rule)', () => {
  it('urgencia = 2 forces urgent: true regardless of overall classification', () => {
    // Every other dimension at 0 keeps the total classification frio,
    // but urgencia=2 alone must still flip `urgent`.
    const result = computeQualification({ necessidade: 0, autoridade: 0, urgencia: 2, enquadramento: 0, dimensao: 0 })
    expect(result.classification).toBe('frio')
    expect(result.urgent).toBe(true)
  })

  it('urgencia = 1 or 0 never sets urgent', () => {
    expect(computeQualification({ urgencia: 1 }).urgent).toBe(false)
    expect(computeQualification({ urgencia: 0 }).urgent).toBe(false)
  })

  it('urgencia unanswered is not urgent', () => {
    expect(computeQualification({ necessidade: 2 }).urgent).toBe(false)
  })
})

describe('urgencyFromDimension', () => {
  it('maps 0/1/2 to low/medium/urgent', () => {
    expect(urgencyFromDimension(0)).toBe('low')
    expect(urgencyFromDimension(1)).toBe('medium')
    expect(urgencyFromDimension(2)).toBe('urgent')
  })

  it('returns undefined when the dimension has not been answered', () => {
    expect(urgencyFromDimension(undefined)).toBeUndefined()
  })
})

describe('parseStoredDimensions', () => {
  it('extracts valid 0/1/2 dimension keys from an unknown JSONB value', () => {
    const parsed = parseStoredDimensions({ necessidade: 2, urgencia: 1, garbage: 'ignored' })
    expect(parsed).toEqual({ necessidade: 2, urgencia: 1 })
  })

  it('drops out-of-range or malformed values instead of throwing', () => {
    expect(parseStoredDimensions({ necessidade: 3, autoridade: 'high', urgencia: null })).toEqual({})
  })

  it('returns {} for non-object input (null, undefined, array, primitive)', () => {
    expect(parseStoredDimensions(null)).toEqual({})
    expect(parseStoredDimensions(undefined)).toEqual({})
    expect(parseStoredDimensions([1, 2, 3])).toEqual({})
    expect(parseStoredDimensions('not an object')).toEqual({})
  })
})
