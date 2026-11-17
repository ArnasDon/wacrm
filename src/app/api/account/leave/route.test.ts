import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  rpcResult: { data: 'acc-personal', error: null } as {
    data: unknown
    error: { code: string; message: string } | null
  },
  rpcCalls: [] as string[],
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(async () => ({
    userId: 'user-1',
    accountId: 'acc-shared',
    role: h.role,
    supabase: {
      rpc: (name: string) => {
        h.rpcCalls.push(name)
        return Promise.resolve(h.rpcResult)
      },
    },
  })),
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth' }, { status: 401 })),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

import { POST } from './route'

beforeEach(() => {
  h.role = 'agent'
  h.rpcResult = { data: 'acc-personal', error: null }
  h.rpcCalls = []
})

describe('POST /api/account/leave', () => {
  it.each(['admin', 'agent', 'viewer'])(
    'lets a %s leave and returns their personal account',
    async (role) => {
      h.role = role
      const res = await POST()
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, newPersonalAccountId: 'acc-personal' })
      expect(h.rpcCalls).toEqual(['leave_account'])
    },
  )

  it('refuses the owner without calling the RPC', async () => {
    h.role = 'owner'
    const res = await POST()
    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('maps the RPC owner guard to a 400', async () => {
    h.rpcResult = { data: null, error: { code: '22023', message: 'owner' } }
    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('maps an RPC authorisation failure to a 403', async () => {
    h.rpcResult = { data: null, error: { code: '42501', message: 'Unauthorized' } }
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it('returns a 500 for an unexpected RPC failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.rpcResult = { data: null, error: { code: 'XX000', message: 'boom' } }
    const res = await POST()
    expect(res.status).toBe(500)
  })
})
