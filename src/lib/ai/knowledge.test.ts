import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }))
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

import { retrieveKnowledge, ingestDocument, resetKnowledgeEmptyCache } from './knowledge'

interface FakeState {
  semantic: { id: string; content: string }[]
  fts: { id: string; content: string }[]
  chunkCount: number
  rpcCalls: string[]
  inserted: Record<string, unknown>[] | null
  deletedFor: string | null
}

function makeDb() {
  const state: FakeState = {
    semantic: [],
    fts: [],
    chunkCount: 5, // account has a non-empty KB by default
    rpcCalls: [],
    inserted: null,
    deletedFor: null,
  }
  const db = {
    rpc: (name: string) => {
      state.rpcCalls.push(name)
      if (name === 'match_ai_knowledge_semantic')
        return Promise.resolve({ data: state.semantic, error: null })
      if (name === 'match_ai_knowledge_fts')
        return Promise.resolve({ data: state.fts, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: () => ({
      // retrieveKnowledge's empty-KB count guard.
      select: () => ({
        eq: () => Promise.resolve({ count: state.chunkCount, error: null }),
      }),
      delete: () => ({
        eq: (_col: string, val: string) => {
          state.deletedFor = val
          return Promise.resolve({ error: null })
        },
      }),
      insert: (rows: Record<string, unknown>[]) => {
        state.inserted = rows
        return Promise.resolve({ error: null })
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, state }
}

beforeEach(() => {
  h.embedTexts.mockReset()
  h.embedTexts.mockImplementation(async (_key: string, inputs: string[]) =>
    inputs.map((_, i) => [i, i]),
  )
  // Every case in this file shares account id 'acct' — without this,
  // the FASE 4 negative cache (module-level, keyed by accountId) would
  // leak "empty" from one test into the next real one.
  resetKnowledgeEmptyCache()
})

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, state } = makeDb()
    expect(await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, '  ')).toEqual([])
    expect(state.rpcCalls).toEqual([])
  })

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')
    expect(out).toEqual([])
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.rpcCalls).toEqual([])
  })

  it('uses lexical FTS only when there is no embeddings key', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(out).toEqual(['F1'])
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts'])
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('uses semantic search when an embeddings key is present', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
      { id: 's3', content: 'S3' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual(['S1', 'S2', 'S3'])
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    // Enough semantic hits → no FTS top-up.
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic'])
  })

  it('remembers an empty KB across calls — a second call skips the count query too (FASE 4)', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    expect(await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')).toEqual([])
    expect(state.rpcCalls).toEqual([])

    // Flip the fake DB to "has chunks" — if the guard re-queried, this
    // would find content; the assertion below proves it didn't even ask.
    state.chunkCount = 5
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(out).toEqual([])
    expect(state.rpcCalls).toEqual([])
  })

  it('an account with real chunks is never short-circuited by another account\'s empty cache entry', async () => {
    const empty = makeDb()
    empty.state.chunkCount = 0
    await retrieveKnowledge(empty.db, 'acct-empty', { embeddingsApiKey: null }, 'q')

    const other = makeDb()
    other.state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(other.db, 'acct-other', { embeddingsApiKey: null }, 'q')
    expect(out).toEqual(['F1'])
    expect(other.state.rpcCalls).toEqual(['match_ai_knowledge_fts'])
  })

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
    ]
    state.fts = [
      { id: 's2', content: 'S2-dup' }, // dedup by id
      { id: 'f1', content: 'F1' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual(['S1', 'S2', 'F1'])
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic',
      'match_ai_knowledge_fts',
    ])
  })
})

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world')
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBe('[0,0]') // literal from mocked embed
    expect(state.inserted![0].account_id).toBe('acct')
  })

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.inserted![0].embedding).toBeNull()
  })

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', '   ')
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toBeNull()
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('clears a cached "empty KB" mark for the account, so the next retrieveKnowledge re-checks (FASE 4)', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    expect(await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')).toEqual([])
    expect(state.rpcCalls).toEqual([])

    // New content arrives for the same account — ingest must forget the
    // "empty" mark, even though this fake DB's count mock still says 0
    // (the ingest and the count-check are independent tables here);
    // once real content lands, a fresh retrieveKnowledge call is
    // expected to ask again rather than trust the stale mark.
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    state.chunkCount = 3
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(out).toEqual(['F1'])
  })

  it('still stores lexical chunks when embedding fails, then rethrows', async () => {
    const { db, state } = makeDb()
    h.embedTexts.mockRejectedValueOnce(new Error('rate limited'))
    await expect(
      ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world'),
    ).rejects.toThrow('rate limited')
    // Chunks were inserted (lexical search works) despite the embed failure…
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBeNull()
  })
})
