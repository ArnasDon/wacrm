import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ requireRole: vi.fn(), ingestKnowledgeDocument: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/ai/knowledge/ingest', () => ({ ingestKnowledgeDocument: h.ingestKnowledgeDocument }))

import { DELETE, PUT } from './route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/ai/knowledge/doc-1', {
    method: 'PUT',
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
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    },
  })
})

describe('PUT /api/ai/knowledge/[id]', () => {
  it('updates through ingestion with the route id', async () => {
    h.ingestKnowledgeDocument.mockResolvedValue({ documentId: 'doc-1', chunkCount: 1, embeddedCount: 0 })
    const res = await PUT(req({ title: 'Updated', content: 'Updated content' }), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(200)
    expect(h.ingestKnowledgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentId: 'doc-1', accountId: 'acct-1' }),
    )
  })
})

describe('DELETE /api/ai/knowledge/[id]', () => {
  it('deletes only by id and current account', async () => {
    const res = await DELETE(new Request('http://localhost/api/ai/knowledge/doc-1'), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(200)
    expect(h.requireRole).toHaveBeenCalledWith('admin')
  })
})
