import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateOpenAiEmbedding: vi.fn() }))
vi.mock('./embeddings', () => ({ generateOpenAiEmbedding: h.generateOpenAiEmbedding }))

import { ingestKnowledgeDocument } from './ingest'

function client() {
  const calls: { table: string; op: string; value?: unknown }[] = []
  return {
    calls,
    from(table: string) {
      return {
        upsert(value: unknown) {
          calls.push({ table, op: 'upsert', value })
          return { select: () => ({ single: async () => ({ data: { id: 'doc-1' }, error: null }) }) }
        },
        delete() {
          calls.push({ table, op: 'delete' })
          return { eq: () => ({ eq: async () => ({ error: null }) }) }
        },
        insert(value: unknown) {
          calls.push({ table, op: 'insert', value })
          return Promise.resolve({ error: null })
        },
      }
    },
  }
}

describe('ingestKnowledgeDocument', () => {
  it('upserts the document, replaces chunks, and embeds when a key exists', async () => {
    h.generateOpenAiEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    const db = client()

    const result = await ingestKnowledgeDocument(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      title: 'Refund policy',
      content: 'Refunds are available within 7 days.',
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })

    expect(result).toEqual({ documentId: 'doc-1', chunkCount: 1, embeddedCount: 1 })
    expect(db.calls.map((call) => `${call.table}:${call.op}`)).toEqual([
      'ai_knowledge_documents:upsert',
      'ai_knowledge_chunks:delete',
      'ai_knowledge_chunks:insert',
    ])
  })
})
