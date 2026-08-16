import { beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'super-secret-value-should-never-leak'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  sendApprovalDecision: vi.fn(),
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
    sendApprovalDecision: mocks.sendApprovalDecision,
  }
})

import { POST } from './route'
import { AiSdrWorkerError } from '@/lib/eter/aisdr-live-client'
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account'

function request(body: unknown): Request {
  return new Request('http://localhost/api/eter-agent/aisdr-live/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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

describe('POST /api/eter-agent/aisdr-live/decision', () => {
  it('requires an authenticated session', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError())
    const res = await POST(request({ approval_id: 1, decision: 'send' }))
    expect(res.status).toBe(401)
    expect(mocks.sendApprovalDecision).not.toHaveBeenCalled()
  })

  it('requires the admin role, rejecting a lower role', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )
    const res = await POST(request({ approval_id: 1, decision: 'send' }))
    expect(res.status).toBe(403)
    expect(mocks.sendApprovalDecision).not.toHaveBeenCalled()
  })

  it('rejects a missing approval_id with 400 and does not call the worker', async () => {
    const res = await POST(request({ decision: 'send' }))
    expect(res.status).toBe(400)
    expect(mocks.sendApprovalDecision).not.toHaveBeenCalled()
  })

  it('rejects a non-integer approval_id with 400', async () => {
    const res = await POST(request({ approval_id: 1.5, decision: 'send' }))
    expect(res.status).toBe(400)
    expect(mocks.sendApprovalDecision).not.toHaveBeenCalled()
  })

  it('rejects an invalid decision value with 400', async () => {
    const res = await POST(request({ approval_id: 1, decision: 'maybe' }))
    expect(res.status).toBe(400)
    expect(mocks.sendApprovalDecision).not.toHaveBeenCalled()
  })

  it('rejects an invalid JSON body with 400', async () => {
    const req = new Request('http://localhost/api/eter-agent/aisdr-live/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('proxies a successful decision to the worker', async () => {
    mocks.sendApprovalDecision.mockResolvedValue({ ok: true })
    const res = await POST(request({ approval_id: 42, decision: 'send' }))
    expect(res.status).toBe(200)
    expect(mocks.sendApprovalDecision).toHaveBeenCalledWith(42, 'send')
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('passes through the idempotent "already" result unchanged', async () => {
    mocks.sendApprovalDecision.mockResolvedValue({ ok: true, already: 'discarded' })
    const res = await POST(request({ approval_id: 42, decision: 'discard' }))
    const body = await res.json()
    expect(body).toEqual({ ok: true, already: 'discarded' })
  })

  it('propagates a network-failure AiSdrWorkerError (no status) as a 502', async () => {
    mocks.sendApprovalDecision.mockRejectedValue(
      new AiSdrWorkerError('Não foi possível contactar o AI SDR.', undefined),
    )
    const res = await POST(request({ approval_id: 1, decision: 'send' }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })

  it('propagates a 401 from the AI SDR worker as a 401', async () => {
    mocks.sendApprovalDecision.mockRejectedValue(
      new AiSdrWorkerError('O AI SDR recusou o pedido.', 401),
    )
    const res = await POST(request({ approval_id: 1, decision: 'send' }))
    expect(res.status).toBe(401)
  })

  it('never includes the raw secret env value in the response, on the happy path either', async () => {
    process.env.APPROVALS_CALLBACK_SECRET = SECRET
    mocks.sendApprovalDecision.mockResolvedValue({ ok: true })
    const res = await POST(request({ approval_id: 1, decision: 'send' }))
    const text = await res.text()
    expect(text).not.toContain(SECRET)
  })
})
