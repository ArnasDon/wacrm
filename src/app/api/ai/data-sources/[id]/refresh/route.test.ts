import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/ai/data-sources/[id]/refresh — FASE 4. Never had a test
// file before. Also pins a related fix found while implementing Bug #3:
// refreshing a missing/foreign id used to surface as 422 (misleadingly
// implying a parse/validation failure) instead of 404. And, since
// refresh re-fetches the source's OWN stored URL, it goes through the
// exact same SSRF protection (assertSafeUrl) as creation — verified
// here too, not assumed from the creation-path tests alone.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  dnsLookup: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

vi.mock('node:dns/promises', () => ({ lookup: mocks.dnsLookup }));

import { POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';

/** Same generic fake as ../../route.test.ts. */
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

function ds(id: string, accountId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, account_id: accountId, source_type: 'remote_csv', display_name: id,
    source_url: 'https://example.com/inventario.csv', source_filename: null, usage: 'knowledge',
    status: 'active', priority: 100, is_primary: false, fallback_policy: 'fallback_on_not_found',
    currency: 'USD', column_mapping: null, row_count: 1, knowledge_document_id: null,
    last_synced_at: null, last_error: null, preview_sample: null, selected_columns: null,
    ...overrides,
  };
}

const REAL_CSV = 'Nombre,Precio,Stock\nProducto A,150,3\n';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.dnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('POST /api/ai/data-sources/[id]/refresh', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('ds-1'));
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('ds-1'));
    expect(res.status).toBe(403);
  });

  it('re-fetches and re-persists a remote_csv source for real', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_CSV, { status: 200 })));
    const { supabase, tables } = fakeSupabase({ ai_data_sources: [ds('ds-1', 'acct-1')] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('ds-1'));
    const body = (await res.json()) as { success: boolean; data_source: { row_count: number } };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data_source.row_count).toBe(1);
    expect(tables.ai_catalog_products ?? []).toEqual([]); // usage=knowledge — never writes catalog rows
    vi.unstubAllGlobals();
  });

  it('BUG #3-related FIX: refreshing a non-existent id → 404, not 422', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('MULTI-TENANT: refreshing another account\'s id → 404, and that source is left completely unmodified', async () => {
    const { supabase, tables } = fakeSupabase({ ai_data_sources: [ds('ds-victim', 'acct-victim', { row_count: 5, last_synced_at: 'original-timestamp' })] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('ds-victim'));
    expect(res.status).toBe(404);
    expect(tables.ai_data_sources[0].row_count).toBe(5);
    expect(tables.ai_data_sources[0].last_synced_at).toBe('original-timestamp');
    expect(mocks.dnsLookup).not.toHaveBeenCalled(); // never even attempted to reach the victim's URL
  });

  it('a genuine parse/fetch failure still returns 422 (unchanged from before this fix)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not csv at all, just html', { status: 200 })));
    const { supabase } = fakeSupabase({ ai_data_sources: [ds('ds-1', 'acct-1', { source_url: 'https://example.com/broken.csv' })] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><html></html>', { status: 200 })));

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('ds-1'));
    expect(res.status).toBe(422);
    vi.unstubAllGlobals();
  });

  it('SSRF PROTECTION APPLIES ON REFRESH TOO: a source whose stored URL now resolves to a private address is blocked, not silently re-synced', async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: '10.0.0.9', family: 4 }]); // DNS changed since creation
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { supabase, tables } = fakeSupabase({
      ai_data_sources: [ds('ds-1', 'acct-1', { source_url: 'http://internal-service.example/x.csv', row_count: 3 })],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('ds-1'));
    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    // The row is marked status=error with last_error set (refreshDataSource's
    // own catch), but its LAST GOOD row_count must not be silently
    // replaced by a blocked fetch's (nonexistent) data.
    expect(tables.ai_data_sources[0].row_count).toBe(3);
    expect(tables.ai_data_sources[0].status).toBe('error');
    vi.unstubAllGlobals();
  });

  it('an uploaded_csv source refreshed without a fresh file → 422 (unchanged, existing behavior)', async () => {
    const { supabase } = fakeSupabase({
      ai_data_sources: [ds('ds-1', 'acct-1', { source_type: 'uploaded_csv', source_url: null, source_filename: 'old.csv' })],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('ds-1'));
    expect(res.status).toBe(422);
  });
});
