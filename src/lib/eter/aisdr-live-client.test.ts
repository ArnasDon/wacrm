import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// aisdr-live-client — the server-only fetch wrapper around the AI SDR
// worker's approval endpoints. Every test here also enforces the
// non-negotiable security property: APPROVALS_CALLBACK_SECRET must
// never appear in a thrown error's message (which routes forward
// straight into a client-facing JSON response).
// ============================================================

const ORIGINAL_ENV = { ...process.env }
const SECRET = 'super-secret-value-should-never-leak'

beforeEach(() => {
  process.env.AI_SDR_WORKER_URL = 'https://ai-sdr.example.internal'
  process.env.APPROVALS_CALLBACK_SECRET = SECRET
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchPendingApprovals', () => {
  it('sends the secret header and default pagination, returns the parsed body', async () => {
    const { fetchPendingApprovals } = await import('./aisdr-live-client')
    const payload = { ok: true, total: 1, limit: 20, offset: 0, approvals: [] }
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(jsonResponse(200, payload))

    const result = await fetchPendingApprovals()

    expect(result).toEqual(payload)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ai-sdr.example.internal/api/approvals/pending?limit=20&offset=0')
    expect((init.headers as Record<string, string>)['X-Approvals-Secret']).toBe(SECRET)
  })

  it('honours custom limit/offset', async () => {
    const { fetchPendingApprovals } = await import('./aisdr-live-client')
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, total: 0, limit: 5, offset: 10, approvals: [] }))

    await fetchPendingApprovals({ limit: 5, offset: 10 })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ai-sdr.example.internal/api/approvals/pending?limit=5&offset=10')
  })

  it('throws AiSdrWorkerError(401) on an unauthorized response, without leaking the secret', async () => {
    const { fetchPendingApprovals, AiSdrWorkerError } = await import('./aisdr-live-client')
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await fetchPendingApprovals().catch((e) => e)
    expect(err).toBeInstanceOf(AiSdrWorkerError)
    expect(err.status).toBe(401)
    expect(err.message).not.toContain(SECRET)
  })

  it('throws AiSdrWorkerError on a non-2xx, non-401 response, without leaking the secret', async () => {
    const { fetchPendingApprovals, AiSdrWorkerError } = await import('./aisdr-live-client')
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(new Response('internal error', { status: 500 }))

    const err = await fetchPendingApprovals().catch((e) => e)
    expect(err).toBeInstanceOf(AiSdrWorkerError)
    expect(err.status).toBe(500)
    expect(err.message).not.toContain(SECRET)
  })

  it('throws AiSdrWorkerError when the worker is unreachable, without leaking the secret', async () => {
    const { fetchPendingApprovals, AiSdrWorkerError } = await import('./aisdr-live-client')
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const err = await fetchPendingApprovals().catch((e) => e)
    expect(err).toBeInstanceOf(AiSdrWorkerError)
    expect(err.message).not.toContain(SECRET)
  })

  it('throws AiSdrWorkerError when the env is not configured, without leaking the secret', async () => {
    delete process.env.AI_SDR_WORKER_URL
    delete process.env.APPROVALS_CALLBACK_SECRET
    const { fetchPendingApprovals, AiSdrWorkerError } = await import('./aisdr-live-client')

    const err = await fetchPendingApprovals().catch((e) => e)
    expect(err).toBeInstanceOf(AiSdrWorkerError)
    expect(err.message).not.toContain(SECRET)
  })
})

describe('sendApprovalDecision', () => {
  it('POSTs approval_id/decision with the secret header, returns the parsed body', async () => {
    const { sendApprovalDecision } = await import('./aisdr-live-client')
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    const result = await sendApprovalDecision(42, 'send')

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ai-sdr.example.internal/api/approvals/decision')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Approvals-Secret']).toBe(SECRET)
    expect(JSON.parse(init.body as string)).toEqual({ approval_id: 42, decision: 'send' })
  })

  it('passes through the idempotent "already" shape unchanged', async () => {
    const { sendApprovalDecision } = await import('./aisdr-live-client')
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, already: 'sent' }))

    const result = await sendApprovalDecision(42, 'discard')
    expect(result).toEqual({ ok: true, already: 'sent' })
  })

  it('throws AiSdrWorkerError(401) without leaking the secret', async () => {
    const { sendApprovalDecision, AiSdrWorkerError } = await import('./aisdr-live-client')
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await sendApprovalDecision(1, 'send').catch((e) => e)
    expect(err).toBeInstanceOf(AiSdrWorkerError)
    expect(err.status).toBe(401)
    expect(err.message).not.toContain(SECRET)
  })
})
