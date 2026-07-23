import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateOpenAiEmbedding: vi.fn() }))
vi.mock('./embeddings', () => ({ generateOpenAiEmbedding: h.generateOpenAiEmbedding }))

import { retrieveKnowledge } from './retrieve'

function rpcClient(options: {
  fts?: { data: unknown[] | null; error: { message: string } | null }
  semantic?: { data: unknown[] | null; error: { message: string } | null }
} = {}) {
  const calls: { name: string; args: unknown }[] = []
  return {
    calls,
    rpc(name: string, args: unknown) {
      calls.push({ name, args })
      if (name === 'match_ai_knowledge_fts') {
        return Promise.resolve(options.fts ?? {
          data: [{ id: 'c1', document_id: 'd1', content: 'Refunds within 7 days', rank: 0.8 }],
          error: null,
        })
      }
      return Promise.resolve(options.semantic ?? {
        data: [{ id: 'c1', document_id: 'd1', content: 'Refunds within 7 days', distance: 0.1 }],
        error: null,
      })
    },
  }
}

describe('retrieveKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no results and makes no calls for a blank trimmed query', async () => {
    const db = rpcClient()

    const results = await retrieveKnowledge(db as never, {
      accountId: 'acct-1',
      query: '   \t\n',
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })

    expect(results).toEqual([])
    expect(db.calls).toEqual([])
    expect(h.generateOpenAiEmbedding).not.toHaveBeenCalled()
  })

  it('runs FTS only when no embedding config is provided', async () => {
    const db = rpcClient()
    const results = await retrieveKnowledge(db as never, {
      accountId: 'acct-1',
      query: '  refund  ',
      matchCount: 4,
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ chunkId: 'c1', mode: 'fts' })
    expect(db.calls).toEqual([{
      name: 'match_ai_knowledge_fts',
      args: { p_account_id: 'acct-1', p_query: 'refund', p_match_count: 4 },
    }])
  })

  it('dedupes hybrid results by chunk id and keeps the strongest score', async () => {
    h.generateOpenAiEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    const db = rpcClient()
    const results = await retrieveKnowledge(db as never, {
      accountId: 'acct-1',
      query: 'refund',
      matchCount: 4,
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].score).toBeGreaterThan(0.8)
    expect(db.calls.map((call) => call.name)).toEqual(['match_ai_knowledge_fts', 'match_ai_knowledge_semantic'])
    expect(db.calls[1]).toEqual({
      name: 'match_ai_knowledge_semantic',
      args: {
        p_account_id: 'acct-1',
        p_query_embedding: '[0.1,0.2,0.3]',
        p_match_count: 4,
      },
    })
  })

  it('limits merged results to matchCount while passing the account scope to both RPCs', async () => {
    h.generateOpenAiEmbedding.mockResolvedValue([0.1, 0.2])
    const db = rpcClient({
      fts: {
        data: [
          { id: 'c1', document_id: 'd1', content: 'One', rank: 0.7 },
          { id: 'c2', document_id: 'd2', content: 'Two', rank: 0.6 },
        ],
        error: null,
      },
      semantic: {
        data: [
          { id: 'c3', document_id: 'd3', content: 'Three', distance: 0.1 },
          { id: 'c4', document_id: 'd4', content: 'Four', distance: 0.2 },
        ],
        error: null,
      },
    })

    const results = await retrieveKnowledge(db as never, {
      accountId: 'acct-scoped',
      query: 'refund',
      matchCount: 2,
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })

    expect(results.map((result) => result.chunkId)).toEqual(['c3', 'c4'])
    expect(db.calls).toEqual([
      {
        name: 'match_ai_knowledge_fts',
        args: { p_account_id: 'acct-scoped', p_query: 'refund', p_match_count: 2 },
      },
      {
        name: 'match_ai_knowledge_semantic',
        args: { p_account_id: 'acct-scoped', p_query_embedding: '[0.1,0.2]', p_match_count: 2 },
      },
    ])
  })

  it('propagates FTS retrieval errors', async () => {
    const db = rpcClient({ fts: { data: null, error: { message: 'fts unavailable' } } })

    await expect(retrieveKnowledge(db as never, {
      accountId: 'acct-1',
      query: 'refund',
    })).rejects.toThrow('Knowledge FTS retrieval failed: fts unavailable')
  })

  it('propagates semantic retrieval errors', async () => {
    h.generateOpenAiEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    const db = rpcClient({ semantic: { data: null, error: { message: 'semantic unavailable' } } })

    await expect(retrieveKnowledge(db as never, {
      accountId: 'acct-1',
      query: 'refund',
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })).rejects.toThrow('Knowledge semantic retrieval failed: semantic unavailable')
  })
})
