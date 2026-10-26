import { describe, expect, it } from 'vitest'
import { initialsOf } from './initials'

describe('initialsOf', () => {
  it('uses the first and last name', () => {
    expect(initialsOf('Maria Santos')).toBe('MS')
    expect(initialsOf('Lina Petraitė Jonaitienė')).toBe('LJ')
  })

  it('uses two letters of a single name', () => {
    expect(initialsOf('arnas')).toBe('AR')
  })

  it('falls back to # for phone numbers and empty names', () => {
    expect(initialsOf('+44 7911 123456')).toBe('#')
    expect(initialsOf('')).toBe('#')
    expect(initialsOf(null)).toBe('#')
  })
})
