import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ingestKnowledgeDocument: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
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

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
      }),
    },
  })
})

describe('GET /api/ai/knowledge', () => {
  it('requires agent role and lists account documents', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.requireRole).toHaveBeenCalledWith('agent')
  })
})

describe('POST /api/ai/knowledge', () => {
  it('400s on blank content', async () => {
    const res = await POST(req({ title: 'Refunds', content: '   ' }))
    expect(res.status).toBe(400)
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
