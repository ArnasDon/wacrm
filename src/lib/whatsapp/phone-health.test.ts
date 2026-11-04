import { describe, expect, it } from 'vitest'
import { parseMessagingLimit, parseQualityRating } from './phone-health'

describe('parseQualityRating', () => {
  it('normalises the three Meta ratings', () => {
    expect(parseQualityRating('GREEN')).toBe('GREEN')
    expect(parseQualityRating('yellow')).toBe('YELLOW')
    expect(parseQualityRating('RED')).toBe('RED')
  })

  it('treats anything else as unknown', () => {
    expect(parseQualityRating('UNKNOWN')).toBe('UNKNOWN')
    expect(parseQualityRating(undefined)).toBe('UNKNOWN')
  })
})

describe('parseMessagingLimit', () => {
  it('reads the tier values Meta documents', () => {
    expect(parseMessagingLimit('TIER_250')).toEqual({ kind: 'tier', perDay: 250 })
    expect(parseMessagingLimit('TIER_2K')).toEqual({ kind: 'tier', perDay: 2000 })
    expect(parseMessagingLimit('TIER_100K')).toEqual({ kind: 'tier', perDay: 100000 })
  })

  it('recognises an unlimited tier', () => {
    expect(parseMessagingLimit('TIER_UNLIMITED')).toEqual({ kind: 'unlimited' })
  })

  it('returns null for missing or unrecognised values', () => {
    expect(parseMessagingLimit(undefined)).toBeNull()
    expect(parseMessagingLimit('TIER_X')).toBeNull()
  })
})
