import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/ai/knowledge/upload-pdf — FASE 3. Never had a test file
// before. Mocks the genuinely external layers: PDF text extraction
// (`pdf-parse`, a real binary-parsing library — not something a unit
// test should feed real bytes to) and the embeddings network call.
// `supabaseAdmin()` is redirected to the SAME in-memory fake the
// RLS-scoped client uses, so an assertion on `tables` sees everything
// this route actually wrote, regardless of which client wrote it.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  embedTexts: vi.fn(),
  extractPdfText: vi.fn(),
  supabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

vi.mock('@/lib/ai/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embeddings')>();
  return { ...actual, embedTexts: mocks.embedTexts };
});

vi.mock('@/lib/pdf-extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf-extract')>();
  return { ...actual, extractPdfText: mocks.extractPdfText };
});

vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { PdfExtractError } from '@/lib/pdf-extract';
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

function formDataRequest(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return new Request('http://localhost/api/ai/knowledge/upload-pdf', { method: 'POST', body: fd });
}

function pdfFile(name = 'garantia.pdf', bytes = 'not real pdf bytes — extractPdfText is mocked') {
  return new File([bytes], name, { type: 'application/pdf' });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.embedTexts.mockReset().mockResolvedValue([[0.1]]);
  mocks.extractPdfText.mockReset().mockResolvedValue('Texto extraído del PDF de garantía.');
  mocks.supabaseAdmin.mockReset();
});

describe('POST /api/ai/knowledge/upload-pdf', () => {
  it('non-admin caller → 403, nothing saved', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await POST(formDataRequest({ file: pdfFile() }));
    expect(res.status).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await POST(formDataRequest({ file: pdfFile() }));
    expect(res.status).toBe(401);
  });

  it('a request with no file field → 400', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(formDataRequest({ title: 'Sin archivo' }));
    expect(res.status).toBe(400);
    expect(mocks.extractPdfText).not.toHaveBeenCalled();
  });

  it('a non-.pdf filename is rejected — 400, extraction never attempted', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(formDataRequest({ file: pdfFile('catalogo.xlsx') }));
    expect(res.status).toBe(400);
    expect(mocks.extractPdfText).not.toHaveBeenCalled();
  });

  it('a valid PDF is saved under the AUTHENTICATED account, defaulting the title from the filename', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-real', userId: 'user-1' });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(formDataRequest({ file: pdfFile('garantia.pdf'), account_id: 'acct-attacker-supplied' }));
    const body = (await res.json()) as { success: boolean; id: string };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const doc = tables.ai_knowledge_documents.find((d) => d.id === body.id)!;
    // account_id came from the session (requireRole), never from the
    // form field the client also sent under the same name.
    expect(doc.account_id).toBe('acct-real');
    expect(doc.type).toBe('manual');
    expect(doc.title).toBe('PDF — garantia.pdf');
    expect(doc.content).toBe('Texto extraído del PDF de garantía.');
  });

  it('an explicit title overrides the filename-derived default', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    await POST(formDataRequest({ file: pdfFile(), title: 'Política de garantía 2026' }));
    expect(tables.ai_knowledge_documents[0].title).toBe('Política de garantía 2026');
  });

  it('really indexes the extracted text — chunks land in ai_knowledge_chunks for real', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(formDataRequest({ file: pdfFile() }));
    const body = (await res.json()) as { id: string };
    expect(res.status).toBe(200);

    const chunks = tables.ai_knowledge_chunks.filter((c) => c.document_id === body.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('Texto extraído del PDF');
  });

  it('a PDF that fails to parse (corrupt/scanned/empty) returns 422 and saves nothing', async () => {
    mocks.extractPdfText.mockRejectedValue(new PdfExtractError('PDF appears to be empty or contains no extractable text.'));
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(formDataRequest({ file: pdfFile() }));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(422);
    expect(body.error).toContain('empty or contains no extractable text');
    expect(tables.ai_knowledge_documents ?? []).toHaveLength(0);
  });

  it('a failed embed still saves the document with a warning, not an error', async () => {
    mocks.embedTexts.mockRejectedValue(new Error('OpenAI down'));
    const { supabase, tables } = fakeSupabase({
      ai_configs: [{ account_id: 'acct-1', embeddings_api_key: encrypt('sk-key') }],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(formDataRequest({ file: pdfFile() }));
    const body = (await res.json()) as { success: boolean; warning?: string };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.warning).toContain('semantic indexing failed');
    expect(tables.ai_knowledge_documents).toHaveLength(1);
  });

  it('a Supabase insert error returns 500', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: {} as never, accountId: 'acct-1', userId: 'user-1' });
    mocks.supabaseAdmin.mockReturnValue({
      from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'db down' } }) }) }) }),
    } as never);

    const res = await POST(formDataRequest({ file: pdfFile() }));
    expect(res.status).toBe(500);
    expect(mocks.extractPdfText).toHaveBeenCalled(); // extraction runs before the insert
  });
});
