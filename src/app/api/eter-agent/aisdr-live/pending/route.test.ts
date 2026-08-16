import { beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'super-secret-value-should-never-leak'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  fetchPendingApprovals: vi.fn(),
}))

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return {
    ...actual,
    requireRole: mocks.requireRole,
    toErrorResponse: actual.toErrorResponse,
  }
})

vi.mock('@/lib/eter/aisdr-live-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/eter/aisdr-live-client')>(
    '@/lib/eter/aisdr-live-client',
  )
  return {
    ...actual,
    fetchPendingApprovals: mocks.fetchPendingApprovals,
  }
})

import { GET } from './route'
import { AiSdrWorkerError } from '@/lib/eter/aisdr-live-client'
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account'

function request(query = ''): Request {
  return new Request(`http://localhost/api/eter-agent/aisdr-live/pending${query}`)
}

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'admin' as const,
  account: { id: 'account-1', name: 'Acme' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue(context)
})

describe('GET /api/eter-agent/aisdr-live/pending', () => {
  it('requires an authenticated session', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError())
    const res = await GET(request())
    expect(res.status).toBe(401)
    expect(mocks.fetchPendingApprovals).not.toHaveBeenCalled()
  })

  it('requires the admin role, rejecting a lower role', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"))
    const res = await GET(request())
    expect(res.status).toBe(403)
    expect(mocks.fetchPendingApprovals).not.toHaveBeenCalled()
  })

  it('proxies a successful response from the AI SDR worker', async () => {
    const payload = {
      ok: true,
      total: 1,
      limit: 20,
      offset: 0,
      approvals: [{ id: 1, tipo: 'reply', estado: 'pending', criadoEm: '2026-08-16T10:00:00Z', resumo: 'x', lead: null, detalhes: {} }],
    }
    mocks.fetchPendingApprovals.mockResolvedValue(payload)

    const res = await GET(request())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(payload)
  })

  it('parses limit/offset query params and clamps limit to the max', async () => {
    mocks.fetchPendingApprovals.mockResolvedValue({ ok: true, total: 0, limit: 50, offset: 40, approvals: [] })
    await GET(request('?limit=999&offset=40'))
    expect(mocks.fetchPendingApprovals).toHaveBeenCalledWith({ limit: 50, offset: 40 })
  })

  it('falls back to defaults for missing/invalid query params', async () => {
    mocks.fetchPendingApprovals.mockResolvedValue({ ok: true, total: 0, limit: 20, offset: 0, approvals: [] })
    await GET(request('?limit=not-a-number'))
    expect(mocks.fetchPendingApprovals).toHaveBeenCalledWith({ limit: 20, offset: 0 })
  })

  it('propagates a network-failure AiSdrWorkerError (no status) as a 502', async () => {
    mocks.fetchPendingApprovals.mockRejectedValue(
      new AiSdrWorkerError('Não foi possível contactar o AI SDR.', undefined),
    )
    const res = await GET(request())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })

  it('propagates a 401 from the AI SDR worker as a 401, not a 500', async () => {
    mocks.fetchPendingApprovals.mockRejectedValue(
      new AiSdrWorkerError('O AI SDR recusou o pedido.', 401),
    )
    const res = await GET(request())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })

  it('never includes the raw secret env value anywhere in the response, on the happy path either', async () => {
    process.env.APPROVALS_CALLBACK_SECRET = SECRET
    mocks.fetchPendingApprovals.mockResolvedValue({ ok: true, total: 0, limit: 20, offset: 0, approvals: [] })
    const res = await GET(request())
    const text = await res.text()
    expect(text).not.toContain(SECRET)
  })
})
