import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET/PATCH/DELETE /api/ai/knowledge/[id] — FASE 3. Never had a test
// file before. Same mocking discipline as ../route.test.ts: only the
// genuinely external layer (embedTexts) is mocked; auth failure status
// codes come from the REAL toErrorResponse/UnauthorizedError/
// ForbiddenError (via importOriginal). The central concern this file
// exists to prove: a caller can never read/modify/delete a document
// that belongs to a DIFFERENT account merely by knowing its UUID — the
// route always filters by `.eq('account_id', accountId)` using the
// account resolved server-side, never anything the client supplies.
// ============================================================

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  embedTexts: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, getCurrentAccount: mocks.getCurrentAccount, requireRole: mocks.requireRole };
});

vi.mock('@/lib/ai/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embeddings')>();
  return { ...actual, embedTexts: mocks.embedTexts };
});

import { GET, PATCH, DELETE } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';

/** Same generic fake as ../route.test.ts — see its comment for the
 *  rationale (real column projection, real chain shape). Duplicated
 *  rather than shared, matching this project's existing route.test.ts
 *  convention (business-profile, ai/config) of a self-contained fake
 *  per test file. */
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

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const DOC_A = {
  id: 'doc-A', account_id: 'acct-A', title: 'Doc de A', content: 'Contenido de A',
  updated_at: 't1', created_at: 't0', type: 'manual', metadata: null,
};

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.requireRole.mockReset();
  mocks.embedTexts.mockReset().mockResolvedValue([[0.1]]);
});

describe('GET /api/ai/knowledge/[id]', () => {
  it('unauthenticated → 401', async () => {
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError());
    const res = await GET(new Request('http://localhost'), params('doc-A'));
    expect(res.status).toBe(401);
  });

  it('returns the document when it belongs to the caller\'s account', async () => {
    const { supabase } = fakeSupabase({ ai_knowledge_documents: [DOC_A] });
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET(new Request('http://localhost'), params('doc-A'));
    const body = (await res.json()) as { id: string; content: string };
    expect(res.status).toBe(200);
    expect(body.content).toBe('Contenido de A');
  });

  it('404 for a document id that does not exist at all', async () => {
    const { supabase } = fakeSupabase({ ai_knowledge_documents: [DOC_A] });
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET(new Request('http://localhost'), params('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('MULTI-TENANT: account B can never GET account A\'s document just by knowing its UUID — 404, not the content', async () => {
    const { supabase } = fakeSupabase({ ai_knowledge_documents: [DOC_A] });
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-B' });

    const res = await GET(new Request('http://localhost'), params('doc-A'));
    const body = (await res.json()) as { error?: string; content?: string };
    expect(res.status).toBe(404);
    expect(body.content).toBeUndefined();
  });
});

describe('PATCH /api/ai/knowledge/[id]', () => {
  function patchRequest(id: string, body: Record<string, unknown>) {
    return PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }), params(id));
  }

  it('non-admin caller → 403, document untouched', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await patchRequest('doc-A', { title: 'Hackeado' });
    expect(res.status).toBe(403);
  });

  it('rejects a body with neither title nor content — 400', async () => {
    const { supabase } = fakeSupabase({ ai_knowledge_documents: [DOC_A] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-1' });

    const res = await patchRequest('doc-A', {});
    expect(res.status).toBe(400);
  });

  it('rejects an explicitly empty title — 400, does not clear it', async () => {
    const { supabase, tables } = fakeSupabase({ ai_knowledge_documents: [{ ...DOC_A }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-1' });

    const res = await patchRequest('doc-A', { title: '' });
    expect(res.status).toBe(400);
    expect(tables.ai_knowledge_documents[0].title).toBe('Doc de A');
  });

  it('updates title only, re-indexes only when content actually changed (it did not here)', async () => {
    const { supabase, tables } = fakeSupabase({ ai_knowledge_documents: [{ ...DOC_A }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-1' });

    const res = await patchRequest('doc-A', { title: 'Nuevo título' });
    expect(res.status).toBe(200);
    expect(tables.ai_knowledge_documents[0].title).toBe('Nuevo título');
    expect(tables.ai_knowledge_documents[0].content).toBe('Contenido de A'); // untouched
    expect(tables.ai_knowledge_chunks ?? []).toHaveLength(0); // no re-index triggered
  });

  it('updating content re-indexes for real — old chunks replaced with new ones', async () => {
    const { supabase, tables } = fakeSupabase({
      ai_knowledge_documents: [{ ...DOC_A }],
      ai_knowledge_chunks: [{ id: 'chunk-old', document_id: 'doc-A', account_id: 'acct-A', content: 'Contenido de A', chunk_index: 0, embedding: null }],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-1' });

    const res = await patchRequest('doc-A', { content: 'Contenido totalmente nuevo y actualizado.' });
    expect(res.status).toBe(200);
    const chunks = tables.ai_knowledge_chunks.filter((c) => c.document_id === 'doc-A');
    expect(chunks.map((c) => c.content)).not.toContain('Contenido de A');
    expect(chunks.some((c) => (c.content as string).includes('totalmente nuevo'))).toBe(true);
  });

  it('404 for a document id that does not exist', async () => {
    const { supabase } = fakeSupabase({ ai_knowledge_documents: [DOC_A] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-1' });

    const res = await patchRequest('does-not-exist', { title: 'x' });
    expect(res.status).toBe(404);
  });

  it('MULTI-TENANT: account B cannot modify account A\'s document by UUID — 404, content unchanged', async () => {
    const { supabase, tables } = fakeSupabase({ ai_knowledge_documents: [{ ...DOC_A }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-B', userId: 'user-b' });

    const res = await patchRequest('doc-A', { title: 'Modificado por B' });
    expect(res.status).toBe(404);
    expect(tables.ai_knowledge_documents[0].title).toBe('Doc de A');
    expect(tables.ai_knowledge_documents[0].account_id).toBe('acct-A');
  });

  it('a Supabase update error returns 500', async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: null, error: { message: 'db down' } }),
              }),
            }),
          }),
        }),
      }),
    } as never;
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-1' });

    const res = await patchRequest('doc-A', { title: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/ai/knowledge/[id]', () => {
  it('non-admin caller → 403, document untouched', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const { tables } = fakeSupabase({ ai_knowledge_documents: [DOC_A] });
    const res = await DELETE(new Request('http://localhost'), params('doc-A'));
    expect(res.status).toBe(403);
    expect(tables.ai_knowledge_documents).toHaveLength(1);
  });

  it('deletes the caller\'s own document', async () => {
    const { supabase, tables } = fakeSupabase({ ai_knowledge_documents: [{ ...DOC_A }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-1' });

    const res = await DELETE(new Request('http://localhost'), params('doc-A'));
    const body = (await res.json()) as { success: boolean };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(tables.ai_knowledge_documents).toHaveLength(0);
  });

  it('MULTI-TENANT: account B\'s DELETE for account A\'s document id leaves it completely intact', async () => {
    const { supabase, tables } = fakeSupabase({ ai_knowledge_documents: [{ ...DOC_A }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-B', userId: 'user-b' });

    const res = await DELETE(new Request('http://localhost'), params('doc-A'));
    expect(res.status).toBe(200); // delete is idempotent — "nothing matched" is still success
    // The decisive assertion: A's document was NOT removed by B's request.
    expect(tables.ai_knowledge_documents).toHaveLength(1);
    expect(tables.ai_knowledge_documents[0].id).toBe('doc-A');
  });

  it('a Supabase delete error returns 500', async () => {
    const supabase = {
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: async () => ({ error: { message: 'db down' } }),
          }),
        }),
      }),
    } as never;
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A', userId: 'user-1' });

    const res = await DELETE(new Request('http://localhost'), params('doc-A'));
    expect(res.status).toBe(500);
  });
});
