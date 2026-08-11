import { describe, expect, it } from 'vitest'
import { estimateCostUsd } from './pricing'

describe('estimateCostUsd', () => {
  it('prices a known OpenAI model from input/output tokens', () => {
    const cost = estimateCostUsd('gpt-5.4-mini', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(0.75 + 4.5)
  })

  it('prices a known Anthropic model', () => {
    const cost = estimateCostUsd('claude-haiku-4-5-20251001', 500_000, 200_000)
    expect(cost).toBeCloseTo(0.5 + 1)
  })

  it('returns null for an unknown/custom model instead of guessing', () => {
    expect(estimateCostUsd('some-future-model', 1_000, 1_000)).toBeNull()
  })

  it('returns 0 for zero usage on a known model', () => {
    expect(estimateCostUsd('gpt-5.4-mini', 0, 0)).toBe(0)
  })
})
