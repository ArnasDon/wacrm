import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  docs: [] as { id: string; content: string }[],
  corrupt: false,
  ingest: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
    supabase: {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: h.docs, error: null }),
        }),
      }),
    },
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 500,
  }),
}))

vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsKey: async () => ({ key: 'sk-embed', corrupt: h.corrupt }),
}))

vi.mock('@/lib/ai/knowledge', () => ({ ingestDocument: h.ingest }))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function reindex() {
  return POST() as unknown as Promise<{ status: number; body: Record<string, unknown> }>
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.corrupt = false
  h.docs = [
    { id: 'doc-1', content: 'one' },
    { id: 'doc-2', content: 'two' },
    { id: 'doc-3', content: 'three' },
  ]
  h.ingest.mockReset()
  h.ingest.mockResolvedValue({ keywordOnly: false, embedError: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/ai/knowledge/reindex', () => {
  it('reindexes every document', async () => {
    const res = await reindex()
    expect(res.body).toEqual({
      success: true,
      reindexed: 3,
      total: 3,
      failed: [],
      keyword_only: [],
    })
  })

  it('keeps going past a failing document and reports it', async () => {
    h.ingest.mockImplementation(async (_db, _acct, _cfg, id: string) => {
      if (id === 'doc-1') throw new Error('insert failed')
      return { keywordOnly: false, embedError: null }
    })
    const res = await reindex()
    expect(h.ingest).toHaveBeenCalledTimes(3)
    expect(res.body).toMatchObject({
      success: false,
      reindexed: 2,
      total: 3,
      failed: ['doc-1'],
    })
  })

  it('reports keyword-only documents separately from failures', async () => {
    h.ingest.mockImplementation(async (_db, _acct, _cfg, id: string) =>
      id === 'doc-2'
        ? { keywordOnly: true, embedError: new Error('rate limited') }
        : { keywordOnly: false, embedError: null },
    )
    const res = await reindex()
    expect(res.body).toMatchObject({
      success: true,
      reindexed: 3,
      failed: [],
      keyword_only: ['doc-2'],
    })
  })

  it('stops before indexing when the embeddings key is corrupt', async () => {
    h.corrupt = true
    const res = await reindex()
    expect(h.ingest).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({ success: false, reindexed: 0 })
  })
})
