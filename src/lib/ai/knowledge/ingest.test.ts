import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateOpenAiEmbedding: vi.fn() }))
vi.mock('./embeddings', () => ({ generateOpenAiEmbedding: h.generateOpenAiEmbedding }))

import { ingestKnowledgeDocument } from './ingest'

const validVector = () => Array.from({ length: 1536 }, (_, index) => index / 10)

type Failure = 'ownership' | 'save' | 'delete' | 'insert'

function client(options: { documentId?: string; failure?: Failure; existingDocument?: boolean } = {}) {
  const calls: { table: string; op: string; value?: unknown; filters?: [string, unknown][] }[] = []
  const error = (message: string) => ({ message })

  return {
    calls,
    from(table: string) {
      const filters: [string, unknown][] = []
      const query = {
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        maybeSingle: async () => {
          calls.push({ table, op: 'ownership', filters: [...filters] })
          return {
            data: options.existingDocument === false ? null : { id: options.documentId ?? 'doc-1' },
            error: options.failure === 'ownership' ? error('ownership failed') : null,
          }
        },
      }

      return {
        select() {
          return query
        },
        upsert(value: unknown) {
          calls.push({ table, op: 'upsert', value })
          return {
            select: () => ({
              single: async () => ({
                data: { id: options.documentId ?? 'doc-1' },
                error: options.failure === 'save' ? error('save failed') : null,
              }),
            }),
          }
        },
        delete() {
          calls.push({ table, op: 'delete', filters })
          return {
            eq(column: string, value: unknown) {
              filters.push([column, value])
              return this
            },
            async then(resolve: (value: { error: { message: string } | null }) => unknown) {
              return resolve({ error: options.failure === 'delete' ? error('delete failed') : null })
            },
          }
        },
        insert(value: unknown) {
          calls.push({ table, op: 'insert', value })
          return Promise.resolve({ error: options.failure === 'insert' ? error('insert failed') : null })
        },
      }
    },
  }
}

describe('ingestKnowledgeDocument', () => {
  beforeEach(() => {
    h.generateOpenAiEmbedding.mockReset()
  })

  it('saves account-scoped chunks with a pgvector literal after embeddings are ready', async () => {
    const vector = validVector()
    h.generateOpenAiEmbedding.mockResolvedValue(vector)
    const db = client()

    const result = await ingestKnowledgeDocument(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      title: ' Refund policy ',
      content: ' Refunds are available within 7 days. ',
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })

    expect(result).toEqual({ documentId: 'doc-1', chunkCount: 1, embeddedCount: 1 })
    expect(db.calls.map((call) => `${call.table}:${call.op}`)).toEqual([
      'ai_knowledge_documents:upsert',
      'ai_knowledge_chunks:delete',
      'ai_knowledge_chunks:insert',
    ])
    expect(db.calls[0].value).toMatchObject({ account_id: 'acct-1', title: 'Refund policy' })
    expect(db.calls[2].value).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        document_id: 'doc-1',
        embedding: `[${vector.join(',')}]`,
      }),
    ])
  })

  it('uses account and document filters before updating an existing document', async () => {
    const db = client({ documentId: 'doc-existing' })

    await ingestKnowledgeDocument(db as never, {
      accountId: 'acct-1', userId: 'user-1', documentId: 'doc-existing', title: 'Policy', content: 'Text',
    })

    expect(db.calls[0]).toMatchObject({
      table: 'ai_knowledge_documents', op: 'ownership', filters: [['id', 'doc-existing'], ['account_id', 'acct-1']],
    })
    expect(db.calls[1].value).toMatchObject({ id: 'doc-existing', account_id: 'acct-1' })
    expect(db.calls[2]).toMatchObject({
      table: 'ai_knowledge_chunks', op: 'delete', filters: [['account_id', 'acct-1'], ['document_id', 'doc-existing']],
    })
  })

  it('stores null embeddings without calling the provider when embedding is not configured', async () => {
    const db = client()

    const result = await ingestKnowledgeDocument(db as never, {
      accountId: 'acct-1', userId: 'user-1', title: 'Policy', content: 'Text', embedding: null,
    })

    expect(result.embeddedCount).toBe(0)
    expect(h.generateOpenAiEmbedding).not.toHaveBeenCalled()
    expect(db.calls[2].value).toEqual([expect.objectContaining({ embedding: null })])
  })

  it.each([
    ['ownership', client({ documentId: 'doc-1', failure: 'ownership' }), 'Failed to validate knowledge document ownership: ownership failed'],
    ['missing ownership', client({ documentId: 'doc-1', existingDocument: false }), 'Knowledge document not found for this account'],
    ['save', client({ failure: 'save' }), 'Failed to save knowledge document: save failed'],
    ['delete', client({ failure: 'delete' }), 'Failed to replace knowledge chunks: delete failed'],
    ['insert', client({ failure: 'insert' }), 'Failed to insert knowledge chunks: insert failed'],
  ])('reports %s failures', async (_name, db, message) => {
    await expect(ingestKnowledgeDocument(db as never, {
      accountId: 'acct-1', userId: 'user-1', documentId: _name.includes('ownership') ? 'doc-1' : undefined,
      title: 'Policy', content: 'Text',
    })).rejects.toThrow(message)
  })

  it('rejects provider and invalid vector failures before deleting current chunks', async () => {
    const providerDb = client()
    h.generateOpenAiEmbedding.mockRejectedValueOnce(new Error('provider failed'))
    await expect(ingestKnowledgeDocument(providerDb as never, {
      accountId: 'acct-1', userId: 'user-1', title: 'Policy', content: 'Text',
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })).rejects.toThrow('provider failed')
    expect(providerDb.calls).toEqual([])

    const invalidVectorDb = client()
    h.generateOpenAiEmbedding.mockResolvedValueOnce([0.1, 0.2, 0.3])
    await expect(ingestKnowledgeDocument(invalidVectorDb as never, {
      accountId: 'acct-1', userId: 'user-1', title: 'Policy', content: 'Text',
      embedding: { apiKey: 'sk-test', model: 'text-embedding-3-small' },
    })).rejects.toThrow('Embedding must contain exactly 1536 finite dimensions')
    expect(invalidVectorDb.calls).toEqual([])
  })
})
