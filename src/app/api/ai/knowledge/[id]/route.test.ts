import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ingestKnowledgeDocument: vi.fn(),
  toErrorResponse: vi.fn(),
  deleteFilters: [] as Array<[string, unknown]>,
  deleteError: null as { message: string } | null,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: h.toErrorResponse,
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

function ctx(id = 'doc-1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.deleteFilters.length = 0
  h.deleteError = null
  h.toErrorResponse.mockImplementation((err: { status?: number }) => new Response(null, { status: err.status ?? 500 }))
  h.requireRole.mockResolvedValue({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        delete: () => ({
          eq: (column: string, value: unknown) => {
            h.deleteFilters.push([column, value])
            return {
              eq: async (nextColumn: string, nextValue: unknown) => {
                h.deleteFilters.push([nextColumn, nextValue])
                return { error: h.deleteError }
              },
            }
          },
        }),
      }),
    },
  })
})

describe('PUT /api/ai/knowledge/[id]', () => {
  it('requires admin role and updates through ingestion with the route id', async () => {
    h.ingestKnowledgeDocument.mockResolvedValue({ documentId: 'doc-1', chunkCount: 1, embeddedCount: 0 })

    const res = await PUT(req({ title: 'Updated', content: 'Updated content' }), ctx())

    expect(res.status).toBe(200)
    expect(h.requireRole).toHaveBeenCalledWith('admin')
    expect(h.ingestKnowledgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentId: 'doc-1', accountId: 'acct-1' }),
    )
  })

  it.each([
    ['blank title', { title: '  ', content: 'Updated content' }],
    ['blank content', { title: 'Updated', content: '  ' }],
    ['oversized content', { title: 'Updated', content: 'a'.repeat(200_001) }],
  ])('400s on %s', async (_case, body) => {
    const res = await PUT(req(body), ctx())

    expect(res.status).toBe(400)
    expect(h.requireRole).toHaveBeenCalledWith('admin')
    expect(h.ingestKnowledgeDocument).not.toHaveBeenCalled()
  })

  it('returns the auth error status', async () => {
    h.requireRole.mockRejectedValueOnce({ status: 401 })

    const res = await PUT(req({ title: 'Updated', content: 'Updated content' }), ctx())

    expect(res.status).toBe(401)
  })

  it('returns an error response when ingestion fails', async () => {
    h.ingestKnowledgeDocument.mockRejectedValueOnce(new Error('write failed'))

    const res = await PUT(req({ title: 'Updated', content: 'Updated content' }), ctx())

    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/ai/knowledge/[id]', () => {
  it('deletes only the route document in the current account', async () => {
    const res = await DELETE(new Request('http://localhost/api/ai/knowledge/other-doc'), ctx('other-doc'))

    expect(res.status).toBe(200)
    expect(h.requireRole).toHaveBeenCalledWith('admin')
    expect(h.deleteFilters).toEqual([
      ['id', 'other-doc'],
      ['account_id', 'acct-1'],
    ])
  })

  it('returns an error response when deletion fails', async () => {
    h.deleteError = { message: 'delete failed' }

    const res = await DELETE(new Request('http://localhost/api/ai/knowledge/doc-1'), ctx())

    expect(res.status).toBe(500)
  })
})
