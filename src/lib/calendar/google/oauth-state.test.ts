import { describe, it, expect } from 'vitest'
import { signOAuthState, verifyOAuthState, OAuthStateError } from './oauth-state'

const secret = 'test-state-secret'

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips a valid state and recovers the accountId', () => {
    const now = new Date('2026-08-07T10:00:00Z')
    const token = signOAuthState('acct-1', secret, now)
    const payload = verifyOAuthState(token, secret, { now })
    expect(payload.accountId).toBe('acct-1')
    expect(payload.iat).toBe(Math.floor(now.getTime() / 1000))
    expect(typeof payload.nonce).toBe('string')
    expect(payload.nonce.length).toBeGreaterThan(0)
  })

  it('two states minted in the same second for the same account differ (nonce)', () => {
    const now = new Date('2026-08-07T10:00:00Z')
    const a = signOAuthState('acct-1', secret, now)
    const b = signOAuthState('acct-1', secret, now)
    expect(a).not.toBe(b)
  })

  it('rejects a tampered payload (accountId swapped after signing)', () => {
    const now = new Date('2026-08-07T10:00:00Z')
    const token = signOAuthState('acct-1', secret, now)
    const [encoded, signature] = token.split('.')
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    payload.accountId = 'acct-EVIL'
    const forgedEncoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const forged = `${forgedEncoded}.${signature}`

    expect(() => verifyOAuthState(forged, secret, { now })).toThrow(OAuthStateError)
    try {
      verifyOAuthState(forged, secret, { now })
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError)
      expect((err as OAuthStateError).code).toBe('invalid_signature')
    }
  })

  it('rejects a state signed with a different secret', () => {
    const now = new Date('2026-08-07T10:00:00Z')
    const token = signOAuthState('acct-1', 'other-secret', now)
    expect(() => verifyOAuthState(token, secret, { now })).toThrow(OAuthStateError)
  })

  it('rejects a malformed token with no separator', () => {
    expect(() => verifyOAuthState('not-a-valid-token', secret)).toThrow(OAuthStateError)
  })

  it('rejects an expired state (older than maxAgeSeconds)', () => {
    const issuedAt = new Date('2026-08-07T10:00:00Z')
    const token = signOAuthState('acct-1', secret, issuedAt)
    const later = new Date(issuedAt.getTime() + 11 * 60 * 1000) // +11 min, default max is 10
    expect(() => verifyOAuthState(token, secret, { now: later })).toThrow(OAuthStateError)
    try {
      verifyOAuthState(token, secret, { now: later })
    } catch (err) {
      expect((err as OAuthStateError).code).toBe('expired')
    }
  })

  it('accepts a state right at the maxAgeSeconds boundary and rejects just past it', () => {
    const issuedAt = new Date('2026-08-07T10:00:00Z')
    const token = signOAuthState('acct-1', secret, issuedAt)
    const withinBounds = new Date(issuedAt.getTime() + 300 * 1000)
    const pastBounds = new Date(issuedAt.getTime() + 301 * 1000)
    expect(() => verifyOAuthState(token, secret, { now: withinBounds, maxAgeSeconds: 300 })).not.toThrow()
    expect(() => verifyOAuthState(token, secret, { now: pastBounds, maxAgeSeconds: 300 })).toThrow(
      OAuthStateError,
    )
  })

  it('rejects a state whose iat is implausibly far in the future', () => {
    const issuedAt = new Date('2026-08-07T10:05:00Z')
    const token = signOAuthState('acct-1', secret, issuedAt)
    const earlier = new Date('2026-08-07T10:00:00Z')
    expect(() => verifyOAuthState(token, secret, { now: earlier })).toThrow(OAuthStateError)
  })
})
