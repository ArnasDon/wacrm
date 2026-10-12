import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// S2 mandatory scenario (d): an invitation token that is expired
// or already used must be refused at the route layer. The deep
// semantics (used/expired detection, the data-loss guard) live in
// the SECURITY DEFINER `redeem_invitation` RPC (migration 019);
// this file proves the route maps every refusal code correctly,
// fails closed on auth, and holds its per-IP rate limit.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  /** What the mocked `supabase.rpc('redeem_invitation', ...)` resolves. */
  rpcResult: { data: 'acc-invited', error: null } as {
    data: unknown
    error: { code: string; message: string } | null
  },
  authed: true,
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () =>
        h.authed
          ? { data: { user: { id: 'user-joiner' } }, error: null }
          : { data: { user: null }, error: null },
    },
    rpc: vi.fn(async (fn: string) => {
      if (fn !== 'redeem_invitation') throw new Error('unexpected rpc: ' + fn)
      return h.rpcResult
    }),
  }),
}))

vi.mock('@/lib/i18n/translate', () => ({
  getT: () => (key: string) => key,
}))

import { POST } from './route'

const params = Promise.resolve({ token: 'opaque-token' })
const req = () =>
  new Request('http://localhost/api/invitations/opaque-token/redeem', {
    method: 'POST',
  })

beforeEach(() => {
  h.rpcResult = { data: 'acc-invited', error: null }
  h.authed = true
})

describe('invitation redeem: refusal contract (S4 scenario d)', () => {
  it('redeems a live token into the inviter account', async () => {
    const res = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, accountId: 'acc-invited' })
  })

  it('maps 42501 (caller unauthenticated inside the RPC) to 401', async () => {
    h.rpcResult = { data: null, error: { code: '42501', message: 'not authenticated' } }
    const res = await POST(req(), { params })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'not authenticated' })
  })

  it('maps 22023 "already used" to 400 — a redeemed token cannot be re-redeemed', async () => {
    h.rpcResult = { data: null, error: { code: '22023', message: 'invitation not found or already used' } }
    const res = await POST(req(), { params })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'invitation not found or already used' })
  })

  it('maps 22023 "expired" to 400 — an expired token is refused, not silently honoured', async () => {
    h.rpcResult = { data: null, error: { code: '22023', message: 'invitation expired' } }
    const res = await POST(req(), { params })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'invitation expired' })
  })

  it('maps 23505 (data-loss guard: caller already has data) to 409', async () => {
    h.rpcResult = { data: null, error: { code: '23505', message: 'caller account already has data' } }
    const res = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'caller account already has data' })
  })

  it('answers 500 with a GENERIC message for an unmapped RPC error (no leak)', async () => {
    h.rpcResult = { data: null, error: { code: 'XX000', message: 'internal detail' } }
    const res = await POST(req(), { params })
    expect(res.status).toBe(500)
    // The route's catch-all must not echo the RPC message.
    expect(res.body).toEqual({ error: 'invitations.redeemFailed' })
  })

  it('refuses an unauthenticated caller before any RPC round trip', async () => {
    h.authed = false
    const res = await POST(req(), { params })
    expect(res.status).toBe(401)
    expect(h.rpcResult).toEqual({ data: 'acc-invited', error: null })
  })
})

describe('invitation redeem: per-IP rate limit', () => {
  it('answers 429 with Retry-After after the invitationRedeem budget (10/min)', async () => {
    const { __resetRateLimitForTests } = await import('@/lib/rate-limit')
    __resetRateLimitForTests()

    for (let i = 0; i < 10; i++) {
      const res = await POST(req(), { params })
      expect(res.status).toBe(200)
    }

    const limited = (await POST(req(), { params })) as unknown as {
      status: number
      body: { retry_after_seconds?: number }
    }
    expect(limited.status).toBe(429)
    expect(limited.body.retry_after_seconds).toBeGreaterThan(0)
  })
})
