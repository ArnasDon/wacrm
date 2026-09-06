import { describe, it, expect } from 'vitest'
import { mapInviteError } from './invite-errors'

describe('mapInviteError', () => {
  it('maps the Supabase email rate limit to 429 with actionable text', () => {
    const r = mapInviteError({ code: 'over_email_send_rate_limit', status: 429, message: '429: email rate limit exceeded' })
    expect(r.status).toBe(429)
    expect(r.message).toMatch(/SMTP/i)
  })

  it('detects a rate limit from the message alone', () => {
    expect(mapInviteError({ message: 'email rate limit exceeded' }).status).toBe(429)
    expect(mapInviteError({ message: 'Too Many Requests' }).status).toBe(429)
  })

  it('maps "already registered" to 409', () => {
    expect(mapInviteError({ message: 'A user with this email address has already been registered' }).status).toBe(409)
    expect(mapInviteError({ code: 'email_exists' }).status).toBe(409)
  })

  it('anything else is a 422 carrying the provider message', () => {
    const r = mapInviteError({ message: 'SMTP connection failed' })
    expect(r.status).toBe(422)
    expect(r.message).toContain('SMTP connection failed')
  })

  it('never returns a 5xx (which the proxy would rewrite to HTML)', () => {
    for (const err of [
      {},
      null,
      { message: '' },
      { status: 500 },
      { code: 'unexpected_failure' },
    ]) {
      expect(mapInviteError(err).status).toBeLessThan(500)
    }
  })
})
