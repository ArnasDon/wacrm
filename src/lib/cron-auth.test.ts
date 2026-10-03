import { describe, it, expect } from 'vitest'
import { verifyCronSecret } from './cron-auth'

describe('verifyCronSecret', () => {
  const secret = 'test-secret-value-32-chars-xx'

  it('accepts x-cron-secret', () => {
    const req = new Request('http://localhost/api/automations/cron', {
      headers: { 'x-cron-secret': secret },
    })
    expect(verifyCronSecret(req, secret)).toBe(true)
  })

  it('accepts Authorization Bearer (Vercel Cron)', () => {
    const req = new Request('http://localhost/api/automations/cron', {
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(verifyCronSecret(req, secret)).toBe(true)
  })

  it('rejects wrong secret', () => {
    const req = new Request('http://localhost/api/automations/cron', {
      headers: { 'x-cron-secret': 'wrong' },
    })
    expect(verifyCronSecret(req, secret)).toBe(false)
  })
})
