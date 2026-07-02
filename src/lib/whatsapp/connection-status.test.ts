import { describe, expect, it } from 'vitest'
import { isAnyProviderConnected } from './connection-status'

describe('isAnyProviderConnected', () => {
  // Regression: an account with both a connected Meta row and a
  // connected Uazapi row previously made the inbox banner show "not
  // connected" because the query used `.maybeSingle()`, which fails when
  // more than one row matches.
  it('is true when at least one of several rows is connected', () => {
    expect(
      isAnyProviderConnected([
        { status: 'connected' },
        { status: 'connected' },
      ]),
    ).toBe(true)
  })

  it('is true when only one of two provider rows is connected', () => {
    expect(
      isAnyProviderConnected([{ status: 'pending' }, { status: 'connected' }]),
    ).toBe(true)
  })

  it('is false when no rows are connected', () => {
    expect(isAnyProviderConnected([{ status: 'pending' }, { status: null }])).toBe(false)
  })

  it('is false for an empty list', () => {
    expect(isAnyProviderConnected([])).toBe(false)
  })

  it('is false for null/undefined (query failed or no config yet)', () => {
    expect(isAnyProviderConnected(null)).toBe(false)
    expect(isAnyProviderConnected(undefined)).toBe(false)
  })
})
