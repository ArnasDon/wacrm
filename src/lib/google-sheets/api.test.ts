import { describe, it, expect } from 'vitest'
import { lastRowOfRange } from './api'

describe('lastRowOfRange', () => {
  it('parses the last row of an A1 range', () => {
    expect(lastRowOfRange('Habitaciones!A5:I6')).toBe(6)
    expect(lastRowOfRange('Sheet1!A1:B1')).toBe(1)
    expect(lastRowOfRange("'Ventas - Eventos'!A12:J12")).toBe(12)
  })

  it('handles a single-cell range', () => {
    expect(lastRowOfRange('Tab!C7')).toBe(7)
  })

  it('returns null for null / unparseable input', () => {
    expect(lastRowOfRange(null)).toBeNull()
    expect(lastRowOfRange('')).toBeNull()
    expect(lastRowOfRange('not a range')).toBeNull()
  })
})
