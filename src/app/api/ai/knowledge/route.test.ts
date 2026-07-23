import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ingestKnowledgeDocument: vi.fn(),
  toErrorResponse: vi.fn(),
  listFilters: [] as Array<[string, unknown]>,
  listError: null as { message: string } | null,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: h.toErrorResponse,
}))
vi.mock('@/lib/ai/knowledge/ingest', () => ({ ingestKnowledgeDocument: h.ingestKnowledgeDocument }))

import { GET, POST } from './route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/ai/knowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function malformedRequest(): Request {
  return new Request('http://localhost/api/ai/knowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.listFilters.length = 0
  h.listError = null
  h.toErrorResponse.mockImplementation((err: { status?: number }) => new Response(null, { status: err.status ?? 500 }))
  h.requireRole.mockResolvedValue({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({
          eq: (column: string, value: unknown) => {
            h.listFilters.push([column, value])
            return { order: async () => ({ data: [], error: h.listError }) }
          },
        }),
      }),
    },
  })
})

describe('GET /api/ai/knowledge', () => {
  it('requires agent role and lists only account documents', async () => {
    const res = await GET()

    expect(res.status).toBe(200)
    expect(h.requireRole).toHaveBeenCalledWith('agent')
    expect(h.listFilters).toEqual([['account_id', 'acct-1']])
  })

  it('returns an error response when the document query fails', async () => {
    h.listError = { message: 'database unavailable' }

    const res = await GET()

    expect(res.status).toBe(500)
  })
})

describe('POST /api/ai/knowledge', () => {
  it.each([
    ['blank title', { title: '   ', content: 'Refund policy' }, 'title is required'],
    ['blank content', { title: 'Refunds', content: '   ' }, 'content is required'],
    ['oversized content', { title: 'Refunds', content: 'a'.repeat(200_001) }, 'content is too long'],
  ])('400s on %s', async (_case, body, message) => {
    const res = await POST(req(body))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ error: expect.stringContaining(message) }))
    expect(h.ingestKnowledgeDocument).not.toHaveBeenCalled()
  })

  it('400s on malformed JSON', async () => {
    const res = await POST(malformedRequest())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'title is required' })
    expect(h.ingestKnowledgeDocument).not.toHaveBeenCalled()
  })

  it('returns the auth error status', async () => {
    h.requireRole.mockRejectedValueOnce({ status: 403 })

    const res = await POST(req({ title: 'Refunds', content: 'Refunds are available.' }))

    expect(res.status).toBe(403)
    expect(h.requireRole).toHaveBeenCalledWith('admin')
    expect(h.ingestKnowledgeDocument).not.toHaveBeenCalled()
  })

  it('returns an error response when ingestion fails', async () => {
    h.ingestKnowledgeDocument.mockRejectedValueOnce(new Error('embedding failed'))

    const res = await POST(req({ title: 'Refunds', content: 'Refunds are available.' }))

    expect(res.status).toBe(500)
  })

  it('ingests an admin-owned document', async () => {
    h.ingestKnowledgeDocument.mockResolvedValue({ documentId: 'doc-1', chunkCount: 2, embeddedCount: 0 })

    const res = await POST(req({ title: 'Refunds', content: 'Refunds are available.' }))

    expect(res.status).toBe(201)
    expect(h.requireRole).toHaveBeenCalledWith('admin')
    expect(h.ingestKnowledgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acct-1', userId: 'user-1' }),
    )
  })
})
