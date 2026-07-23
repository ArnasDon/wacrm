import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiConfig: vi.fn(),
  ingestKnowledgeDocument: vi.fn(),
  toErrorResponse: vi.fn(),
  deleteFilters: [] as Array<[string, unknown]>,
  deleteError: null as { message: string } | null,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: h.toErrorResponse,
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
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
  h.loadAiConfig.mockResolvedValue(null)
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

  it('passes decrypted embedding configuration when semantic knowledge is configured', async () => {
    h.loadAiConfig.mockResolvedValue({
      knowledgeEnabled: true,
      embeddingsApiKey: 'sk-embeddings',
      embeddingsModel: 'text-embedding-test',
    })
    h.ingestKnowledgeDocument.mockResolvedValue({ documentId: 'doc-1', chunkCount: 1, embeddedCount: 1 })

    const res = await PUT(req({ title: 'Updated', content: 'Updated content' }), ctx())

    expect(res.status).toBe(200)
    expect(h.loadAiConfig).toHaveBeenCalledWith(expect.anything(), 'acct-1')
    expect(h.ingestKnowledgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        embedding: {
          apiKey: 'sk-embeddings',
          model: 'text-embedding-test',
        },
      }),
    )
    await expect(res.json()).resolves.not.toEqual(expect.objectContaining({ apiKey: expect.anything() }))
  })

  it.each([
    ['missing config', null],
    [
      'disabled knowledge',
      {
        knowledgeEnabled: false,
        embeddingsApiKey: 'sk-embeddings',
        embeddingsModel: 'text-embedding-test',
      },
    ],
    [
      'unconfigured embeddings',
      {
        knowledgeEnabled: true,
        embeddingsApiKey: null,
        embeddingsModel: 'text-embedding-test',
      },
    ],
  ])('passes null embeddings for %s', async (_case, config) => {
    h.loadAiConfig.mockResolvedValue(config)
    h.ingestKnowledgeDocument.mockResolvedValue({ documentId: 'doc-1', chunkCount: 1, embeddedCount: 0 })

    await PUT(req({ title: 'Updated', content: 'Updated content' }), ctx())

    expect(h.ingestKnowledgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embedding: null }),
    )
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
