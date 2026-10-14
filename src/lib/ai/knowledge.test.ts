import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqlConnection } from '@/lib/db/transaction';

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }));
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}));

import { retrieveKnowledge, ingestDocument } from './knowledge';

interface FakeState {
  semantic: { id: string; content: string }[];
  fts: { id: string; content: string }[];
  chunkCount: number;
  rpcCalls: string[];
  inserted: Record<string, unknown>[] | null;
  content: string;
  deletedFor: string | null;
}

function makeDb() {
  const state: FakeState = {
    content: 'hello world',
    semantic: [],
    fts: [],
    chunkCount: 5, // account has a non-empty KB by default
    rpcCalls: [],
    inserted: null,
    deletedFor: null,
  };
  const db: SqlConnection = {
    query: async (sql, values = []) => {
      if (sql.includes('SELECT content FROM public.ai_knowledge_documents'))
        return { rows: [{ content: state.content }] };
      if (sql.includes('SELECT id FROM public.ai_knowledge_chunks'))
        return { rows: state.chunkCount ? [{ id: 'chunk' }] : [] };
      if (sql.includes('CROSS JOIN LATERAL')) {
        state.rpcCalls.push('match_ai_knowledge_semantic');
        return { rows: state.semantic };
      }
      if (sql.includes('websearch_to_tsquery')) {
        state.rpcCalls.push('match_ai_knowledge_fts');
        return { rows: state.fts };
      }
      if (sql.includes('DELETE FROM public.ai_knowledge_chunks')) {
        state.deletedFor = values[1] as string;
        state.inserted = null;
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO public.ai_knowledge_chunks')) {
        (state.inserted ??= []).push({
          account_id: values[0],
          document_id: values[1],
          chunk_index: values[2],
          content: values[3],
          embedding: values[4],
        });
        return { rows: [] };
      }
      throw new Error('Unexpected SQL');
    },
  };
  return {
    db,
    state,
    run: <T>(work: (db: SqlConnection) => Promise<T>) => work(db),
  };
}

beforeEach(() => {
  h.embedTexts.mockReset();
  h.embedTexts.mockImplementation(async (_key: string, inputs: string[]) =>
    inputs.map((_, i) => [i, i])
  );
});

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, run, state } = makeDb();
    expect(
      await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, '  ')
    ).toEqual([]);
    expect(state.rpcCalls).toEqual([]);
  });

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, run, state } = makeDb();
    state.chunkCount = 0;
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'q'
    );
    expect(out).toEqual([]);
    expect(h.embedTexts).not.toHaveBeenCalled();
    expect(state.rpcCalls).toEqual([]);
  });

  it('uses lexical FTS only when there is no embeddings key', async () => {
    const { db, run, state } = makeDb();
    state.fts = [{ id: 'f1', content: 'F1' }];
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: null },
      'q'
    );
    expect(out).toEqual(['F1']);
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts']);
    expect(h.embedTexts).not.toHaveBeenCalled();
  });

  it('uses semantic search when an embeddings key is present', async () => {
    const { db, run, state } = makeDb();
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
      { id: 's3', content: 'S3' },
    ];
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'q',
      3
    );
    expect(out).toEqual(['S1', 'S2', 'S3']);
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
    // Enough semantic hits → no FTS top-up.
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic']);
  });

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, run, state } = makeDb();
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
    ];
    state.fts = [
      { id: 's2', content: 'S2-dup' }, // dedup by id
      { id: 'f1', content: 'F1' },
    ];
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'q',
      3
    );
    expect(out).toEqual(['S1', 'S2', 'F1']);
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic',
      'match_ai_knowledge_fts',
    ]);
  });
});

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, run, state } = makeDb();
    await ingestDocument(
      run,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'doc-1',
      'hello world'
    );
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
    expect(state.deletedFor).toBe('doc-1');
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted![0].embedding).toEqual([0, 0]); // literal from mocked embed
    expect(state.inserted![0].account_id).toBe('acct');
  });

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, run, state } = makeDb();
    await ingestDocument(
      run,
      'acct',
      { embeddingsApiKey: null },
      'doc-1',
      'hello world'
    );
    expect(h.embedTexts).not.toHaveBeenCalled();
    expect(state.inserted![0].embedding).toBeNull();
  });

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, run, state } = makeDb();
    state.content = '   ';
    await ingestDocument(
      run,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'doc-1',
      '   '
    );
    expect(state.deletedFor).toBe('doc-1');
    expect(state.inserted).toBeNull();
    expect(h.embedTexts).not.toHaveBeenCalled();
  });

  it('still stores lexical chunks when embedding fails, then rethrows', async () => {
    const { db, run, state } = makeDb();
    h.embedTexts.mockRejectedValueOnce(new Error('rate limited'));
    await expect(
      ingestDocument(
        run,
        'acct',
        { embeddingsApiKey: 'sk-x' },
        'doc-1',
        'hello world'
      )
    ).rejects.toThrow('rate limited');
    // Chunks were inserted (lexical search works) despite the embed failure…
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted![0].embedding).toBeNull();
  });
});
