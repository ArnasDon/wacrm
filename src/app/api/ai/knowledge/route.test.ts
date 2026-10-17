import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET/POST /api/ai/knowledge — FASE 3 (blindaje HTTP de Knowledge Base).
// This route never had a test file before (verified in the prior audit).
// Mocks only the genuinely external layer (embedTexts — a real network
// call to OpenAI); `getCurrentAccount`/`requireRole` are replaced but
// `toErrorResponse`, `UnauthorizedError`, `ForbiddenError` are the REAL
// ones (via importOriginal) so auth-failure status codes are asserted
// against the actual contract, not reinvented. `ingestDocument`,
// `chunkText`, `loadEmbeddingsKey` all run for real against the fake
// Supabase below — this proves the route actually indexes a document,
// not just that a mock was called (see FASE 3's explicit "no falsear
// tests" rule).
// ============================================================

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  embedTexts: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return {
    ...actual,
    getCurrentAccount: mocks.getCurrentAccount,
    requireRole: mocks.requireRole,
  };
});

vi.mock('@/lib/ai/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embeddings')>();
  return { ...actual, embedTexts: mocks.embedTexts };
});

import { GET, POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';

/**
 * Generic in-memory multi-table fake modeled on the real PostgREST
 * builder chain (select/insert/update/delete, each chainable with
 * `.eq()`/`.select()`/`.single()`/`.maybeSingle()`, and awaitable at any
 * point) — covers every exact call shape route.ts and knowledge.ts
 * actually use, without inventing a contract for either.
 */
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

    // Real PostgREST only ever returns the columns actually requested
    // via `.select('a, b, c')` — projecting here (instead of returning
    // the whole fake row) is what makes a test's assertion on the exact
    // response shape meaningful rather than accidentally passing because
    // the fake over-shares columns route.ts never selected.
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

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.requireRole.mockReset();
  mocks.embedTexts.mockReset().mockResolvedValue([[0.1, 0.2]]);
});

describe('GET /api/ai/knowledge', () => {
  it('an unauthenticated caller gets 401 and no query ever runs', async () => {
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError());
    const { supabase, tables } = fakeSupabase({
      ai_knowledge_documents: [{ id: 'doc-1', account_id: 'acct-1', title: 'x', content: 'y', type: 'manual', metadata: null }],
    });
    // supabase is never even reached — getCurrentAccount rejects first.
    void supabase;

    const res = await GET();
    expect(res.status).toBe(401);
    expect(tables.ai_knowledge_documents).toHaveLength(1); // untouched
  });

  it('returns only the authenticated account\'s documents', async () => {
    const { supabase } = fakeSupabase({
      ai_knowledge_documents: [
        { id: 'doc-1', account_id: 'acct-1', title: 'Doc A', content: 'x', updated_at: 't1', type: 'manual', metadata: null },
      ],
    });
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET();
    const body = (await res.json()) as { documents: { id: string; title: string }[] };
    expect(res.status).toBe(200);
    expect(body.documents).toEqual([
      { id: 'doc-1', title: 'Doc A', updated_at: 't1', type: 'manual', metadata: null },
    ]);
  });

  it('multi-tenant isolation: never returns another account\'s documents', async () => {
    const { supabase } = fakeSupabase({
      ai_knowledge_documents: [
        { id: 'doc-b1', account_id: 'acct-B', title: 'Secreto de B', content: 'x', updated_at: 't1', type: 'manual', metadata: null },
      ],
    });
    // Account A is the one actually authenticated.
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET();
    const body = (await res.json()) as { documents: unknown[] };
    expect(body.documents).toEqual([]);
  });
});

describe('POST /api/ai/knowledge', () => {
  function postRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/ai/knowledge', { method: 'POST', body: JSON.stringify(body) });
  }

  it('a non-admin caller (viewer/agent) gets 403 and nothing is inserted', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await POST(postRequest({ title: 'x', content: 'y' }));
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller gets 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await POST(postRequest({ title: 'x', content: 'y' }));
    expect(res.status).toBe(401);
  });

  it('rejects a body missing title/content with 400 and inserts nothing', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postRequest({ title: '', content: '' }));
    expect(res.status).toBe(400);
    expect(tables.ai_knowledge_documents ?? []).toHaveLength(0);
  });

  it('creates the document under the AUTHENTICATED account, ignoring any account_id the client sends in the body', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-real', userId: 'user-1' });

    const res = await POST(postRequest({
      title: 'Horarios',
      content: 'Abrimos de 9 a 5.',
      account_id: 'acct-attacker-supplied', // the route never reads this field
    }));
    const body = (await res.json()) as { success: boolean; id: string };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const doc = tables.ai_knowledge_documents.find((d) => d.id === body.id)!;
    expect(doc.account_id).toBe('acct-real');
    expect(doc.title).toBe('Horarios');
  });

  it('really indexes the document — chunks land in ai_knowledge_chunks for real, not just a mocked call', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postRequest({ title: 'Políticas', content: 'Garantía de 90 días en todos los productos.' }));
    const body = (await res.json()) as { id: string };
    expect(res.status).toBe(200);

    const chunks = tables.ai_knowledge_chunks.filter((c) => c.document_id === body.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('Garantía de 90 días');
    expect(chunks[0].account_id).toBe('acct-1');
  });

  it('embeds the chunk with the account\'s real (encrypted) embeddings key when one is configured', async () => {
    const { supabase, tables } = fakeSupabase({
      ai_configs: [{ account_id: 'acct-1', embeddings_api_key: encrypt('sk-real-embeddings-key') }],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    await POST(postRequest({ title: 'Catálogo', content: 'Producto de prueba.' }));

    expect(mocks.embedTexts).toHaveBeenCalledWith('sk-real-embeddings-key', expect.any(Array));
    const chunk = tables.ai_knowledge_chunks[0];
    expect(chunk.embedding).not.toBeNull();
  });

  it('a failed embed still saves the document (lexical-only) and reports a warning instead of failing the request', async () => {
    mocks.embedTexts.mockRejectedValue(new Error('OpenAI rate limited'));
    const { supabase, tables } = fakeSupabase({
      ai_configs: [{ account_id: 'acct-1', embeddings_api_key: encrypt('sk-real-embeddings-key') }],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postRequest({ title: 'Catálogo', content: 'Producto de prueba.' }));
    const body = (await res.json()) as { success: boolean; warning?: string };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.warning).toContain('semantic indexing failed');
    // The document itself must still exist — an embed failure is not a save failure.
    expect(tables.ai_knowledge_documents).toHaveLength(1);
    const chunks = tables.ai_knowledge_chunks;
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].embedding).toBeNull();
  });

  it('a Supabase insert error returns 500 and never calls the indexing pipeline', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: 'connection reset' } }),
          }),
        }),
      }),
    } as never;
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postRequest({ title: 'x', content: 'y' }));
    expect(res.status).toBe(500);
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });
});
