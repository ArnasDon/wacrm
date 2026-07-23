import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateOpenAiEmbedding: vi.fn() }))
vi.mock('./embeddings', () => ({ generateOpenAiEmbedding: h.generateOpenAiEmbedding }))

import { retrieveKnowledge } from './retrieve'

function rpcClient() {
  const calls: { name: string; args: unknown }[] = []
  return {
    calls,
    rpc(name: string, args: unknown) {
      calls.push({ name, args })
      if (name === 'match_ai_knowledge_fts') {
        return Promise.resolve({
          data: [{ id: 'c1', document_id: 'd1', content: 'Refunds within 7 days', rank: 0.8 }],
          error: null,
        })
      }
      return Promise.resolve({
        data: [{ id: 'c1', document_id: 'd1', content: 'Refunds within 7 days', distance: 0.1 }],
        error: null,
      })
    },
  }
}

describe('retrieveKnowledge', () => {
  it('runs FTS only when no embedding config is provided', async () => {
    const db = rpcClient()
    const results = await retrieveKnowledge(db as never, {
      accountId: 'acct-1',
      query: 'refund',
      matchCount: 4,
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ chunkId: 'c1', mode: 'fts' })
    expect(db.calls.map((call) => call.name)).toEqual(['match_ai_knowledge_fts'])
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
  })
})
