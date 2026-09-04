import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/ai/knowledge/reindex — FASE 3. Never had a test file
// before. This suite also pins the FASE 3 audit's bug fix: reindexing
// N documents where one fails must still attempt every OTHER document
// (a `return` used to sit inside the loop's `catch`, aborting the whole
// batch on the first failure — see the route's own comment history).
// Only embedTexts (the real network call) is mocked; ingestDocument and
// its chunking run for real against the fake Supabase below.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  embedTexts: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

vi.mock('@/lib/ai/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embeddings')>();
  return { ...actual, embedTexts: mocks.embedTexts };
});

import { POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';

/** Same generic fake as ../route.test.ts. */
function fakeSupabase(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let nextId = 1;

  function ensure(name: string) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function builder(table: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Record<string, unknown> | Record<string, unknown>[] | undefined;
    const filters: [string, unknown][] = [];
    let single: 'one' | 'maybe' | null = null;
    let selectedCols: string[] | null = null;
    const rows = ensure(table);
    const matches = (row: Record<string, unknown>) => filters.every(([c, v]) => row[c] === v);

    function project<T extends Record<string, unknown>>(row: T): T {
      if (!selectedCols) return row;
      const out = {} as Record<string, unknown>;
      for (const col of selectedCols) out[col] = row[col];
      return out as T;
    }

    function execute(): { data: unknown; error: unknown } {
      if (op === 'select') {
        const matched = rows.filter(matches).map(project);
        if (single === 'one') return matched[0] ? { data: matched[0], error: null } : { data: null, error: { message: 'no rows' } };
        if (single === 'maybe') return { data: matched[0] ?? null, error: null };
        return { data: matched, error: null };
      }
      if (op === 'insert') {
        const items = Array.isArray(payload) ? payload : [payload as Record<string, unknown>];
        const inserted = items.map((p) => ({ id: `${table}-${nextId++}`, created_at: 'now', updated_at: 'now', ...p }));
        rows.push(...inserted);
        const returned = inserted.map(project);
        if (single === 'one' || single === 'maybe') return { data: returned[0] ?? null, error: null };
        return { data: returned, error: null };
      }
      if (op === 'update') {
        const matched = rows.filter(matches);
        for (const row of matched) Object.assign(row, payload);
        const returned = matched.map(project);
        if (single === 'one') return returned[0] ? { data: returned[0], error: null } : { data: null, error: { message: 'no rows' } };
        if (single === 'maybe') return { data: returned[0] ?? null, error: null };
        return { data: returned, error: null };
      }
      if (op === 'delete') {
        const remaining = rows.filter((r) => !matches(r));
        rows.length = 0;
        rows.push(...remaining);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }

    const api = {
      select: (cols?: string) => {
        if (op !== 'insert' && op !== 'update') op = 'select';
        if (cols) selectedCols = cols.split(',').map((c) => c.trim());
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      order: () => api,
      insert: (p: Record<string, unknown> | Record<string, unknown>[]) => {
        op = 'insert';
        payload = p;
        return api;
      },
      update: (p: Record<string, unknown>) => {
        op = 'update';
        payload = p;
        return api;
      },
      delete: () => {
        op = 'delete';
        return api;
      },
      single: () => {
        single = 'one';
        return Promise.resolve(execute());
      },
      maybeSingle: () => {
        single = 'maybe';
        return Promise.resolve(execute());
      },
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(execute()).then(resolve, reject),
    };
    return api;
  }

  return {
    supabase: { from: (table: string) => builder(table) } as never,
    tables,
  };
}

function doc(id: string, accountId: string, content: string) {
  return { id, account_id: accountId, title: id, content, type: 'manual', metadata: null };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.embedTexts.mockReset().mockResolvedValue([[0.1]]);
});

describe('POST /api/ai/knowledge/reindex', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it('an account with zero documents reindexes zero, successfully', async () => {
    const { supabase } = fakeSupabase({ ai_knowledge_documents: [] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST();
    const body = (await res.json()) as { success: boolean; reindexed: number };
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, reindexed: 0 });
  });

  it('re-chunks every document of the account for real — new chunks exist with the right content', async () => {
    const { supabase, tables } = fakeSupabase({
      ai_knowledge_documents: [doc('d1', 'acct-1', 'Contenido uno'), doc('d2', 'acct-1', 'Contenido dos')],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST();
    const body = (await res.json()) as { success: boolean; reindexed: number };
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, reindexed: 2 });
    expect(tables.ai_knowledge_chunks.some((c) => (c.content as string).includes('Contenido uno'))).toBe(true);
    expect(tables.ai_knowledge_chunks.some((c) => (c.content as string).includes('Contenido dos'))).toBe(true);
  });

  it('MULTI-TENANT: reindexing account A never touches account B\'s documents/chunks', async () => {
    const { supabase, tables } = fakeSupabase({
      ai_knowledge_documents: [doc('a1', 'acct-A', 'Contenido de A'), doc('b1', 'acct-B', 'Contenido de B')],
      ai_knowledge_chunks: [{ id: 'chunk-b', document_id: 'b1', account_id: 'acct-B', content: 'Contenido de B', chunk_index: 0, embedding: null }],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-a' });

    const res = await POST();
    const body = (await res.json()) as { reindexed: number };
    expect(body.reindexed).toBe(1); // only A's one document
    // B's original chunk survives untouched — never deleted/re-inserted.
    const bChunks = tables.ai_knowledge_chunks.filter((c) => c.document_id === 'b1');
    expect(bChunks).toEqual([{ id: 'chunk-b', document_id: 'b1', account_id: 'acct-B', content: 'Contenido de B', chunk_index: 0, embedding: null }]);
  });

  it('BUG FIX (FASE 3 audit): one document failing mid-batch does NOT abort the rest — every other document still gets reindexed', async () => {
    const { supabase, tables } = fakeSupabase({
      ai_knowledge_documents: [
        doc('d1', 'acct-1', 'Primero'),
        doc('d2', 'acct-1', 'Segundo — este falla'),
        doc('d3', 'acct-1', 'Tercero'),
      ],
      // An embeddings key present so ingestDocument actually calls
      // embedTexts (only then can a "mid-run embeddings failure" happen).
      ai_configs: [{ account_id: 'acct-1', embeddings_api_key: encrypt('sk-key') }],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    mocks.embedTexts
      .mockResolvedValueOnce([[0.1]]) // d1 succeeds
      .mockRejectedValueOnce(new Error('rate limited')) // d2 fails
      .mockResolvedValueOnce([[0.3]]); // d3 must still be attempted

    const res = await POST();
    const body = (await res.json()) as { success: boolean; reindexed: number; total: number; failed: number };
    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.total).toBe(3);
    // The decisive assertion: d1 AND d3 both made it through — d3 was
    // NOT skipped because d2 failed before it.
    expect(body.reindexed).toBe(2);
    expect(body.failed).toBe(1);
    expect(tables.ai_knowledge_chunks.some((c) => (c.content as string).includes('Primero'))).toBe(true);
    expect(tables.ai_knowledge_chunks.some((c) => (c.content as string).includes('Tercero'))).toBe(true);
  });

  it('an undecryptable embeddings key stops before reindexing anything and reports it plainly', async () => {
    const { supabase } = fakeSupabase({
      ai_knowledge_documents: [doc('d1', 'acct-1', 'x')],
      ai_configs: [{ account_id: 'acct-1', embeddings_api_key: 'not-a-valid-cipher-blob' }],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST();
    const body = (await res.json()) as { success: boolean; reindexed: number; error: string };
    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.reindexed).toBe(0);
    expect(body.error).toContain('could not be decrypted');
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it('a Supabase fetch error returns 500', async () => {
    const supabase = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'db down' } }) }) }) } as never;
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST();
    expect(res.status).toBe(500);
  });
});
