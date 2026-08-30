import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/ai/data-sources/[id]/preview — FASE 4. Never had a test
// file before. Read-only "Ver datos" — no bug was found here in the
// audit (it already correctly returns 404 for a missing/foreign id),
// but it had zero HTTP-level test coverage.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

import { GET } from './route';
import { UnauthorizedError } from '@/lib/auth/account';

/** Same generic fake as ../../route.test.ts. */
function fakeSupabase(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

  function ensure(name: string) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let selectedCols: string[] | null = null;
    const rows = ensure(table);
    const matches = (row: Record<string, unknown>) => filters.every(([c, v]) => row[c] === v);
    function project<T extends Record<string, unknown>>(row: T): T {
      if (!selectedCols) return row;
      const out = {} as Record<string, unknown>;
      for (const col of selectedCols) out[col] = row[col];
      return out as T;
    }
    const api = {
      select: (cols?: string) => {
        if (cols) selectedCols = cols.split(',').map((c) => c.trim());
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      maybeSingle: async () => {
        const matched = rows.filter(matches).map(project);
        return { data: matched[0] ?? null, error: null };
      },
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

function ds(id: string, accountId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, account_id: accountId, source_type: 'uploaded_csv', display_name: id,
    source_url: null, source_filename: 'x.csv', usage: 'knowledge', status: 'active',
    priority: 100, is_primary: false, fallback_policy: 'fallback_on_not_found', currency: 'USD',
    column_mapping: null, row_count: 1, knowledge_document_id: null, last_synced_at: null,
    last_error: null,
    preview_sample: { sample: [{ Nombre: 'Producto A', Precio: '100' }], columns: ['Nombre', 'Precio'] },
    selected_columns: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
});

describe('GET /api/ai/data-sources/[id]/preview', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await GET(new Request('http://localhost'), params('ds-1'));
    expect(res.status).toBe(401);
  });

  it('returns the real persisted sample for the caller\'s own source', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [ds('ds-1', 'acct-1')] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET(new Request('http://localhost'), params('ds-1'));
    const body = (await res.json()) as { preview: { kind: string; rows: Record<string, string>[] } };
    expect(res.status).toBe(200);
    expect(body.preview.kind).toBe('sheet');
    expect(body.preview.rows[0].Nombre).toBe('Producto A');
  });

  it('reports kind=empty for a source with no preview_sample yet, not an error', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [ds('ds-1', 'acct-1', { preview_sample: null })] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET(new Request('http://localhost'), params('ds-1'));
    const body = (await res.json()) as { preview: { kind: string; rows: unknown[] } };
    expect(res.status).toBe(200);
    expect(body.preview.kind).toBe('empty');
    expect(body.preview.rows).toEqual([]);
  });

  it('404 for a non-existent id', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET(new Request('http://localhost'), params('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('MULTI-TENANT: previewing another account\'s source id → 404, never the real data', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [ds('ds-victim', 'acct-victim')] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker' });

    const res = await GET(new Request('http://localhost'), params('ds-victim'));
    const body = (await res.json()) as { preview?: unknown };
    expect(res.status).toBe(404);
    expect(body.preview).toBeUndefined();
  });
});
