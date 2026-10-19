import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/internal/data-source-sync — lets Google Apps Script (no
// human session) trigger a re-import of ONE pre-configured, URL-based
// data source after it updates the Google Sheet from Gmail-forwarded
// inventory emails. Same shared-secret discipline as
// /api/internal/heartbeat and /api/automations/cron.
// ============================================================

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  // Real implementation by default (set below, once, from the actual
  // module) — every existing test still exercises the REAL
  // refreshDataSource against the fake DB. Only the two new tests for
  // an unexpected exception override it per-call with
  // `mockRejectedValueOnce`, which reverts to this real passthrough
  // immediately afterward.
  refreshDataSource: vi.fn(),
}));

vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock('@/lib/ai/data-sources/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/data-sources/service')>();
  mocks.refreshDataSource.mockImplementation(actual.refreshDataSource);
  return { ...actual, refreshDataSource: mocks.refreshDataSource };
});

import { POST } from './route';

/** Same shape as ../../ai/data-sources/[id]/refresh/route.test.ts's own fake. */
function fakeSupabase(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let nextId = 1;

  function ensure(name: string) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function builder(table: string) {
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let payload: Record<string, unknown> | Record<string, unknown>[] | undefined;
    let onConflict: string | undefined;
    const filters: [string, unknown][] = [];
    let single: 'one' | 'maybe' | null = null;
    let selectedCols: string[] | null = null;
    let orClauses: [string, 'is' | 'lt', string][] | null = null;
    // Models PostgREST's real default page cap (see the AI agent audit
    // fix in data-sources/service.ts): an unranged `.select()` only
    // returns the first DEFAULT_PAGE_SIZE rows.
    const DEFAULT_PAGE_SIZE = 1000;
    let range: [number, number] | null = null;
    const rows = ensure(table);
    const matchesOr = (row: Record<string, unknown>) => {
      if (!orClauses) return true;
      return orClauses.some(([col, cmpOp, val]) => {
        const current = row[col];
        if (cmpOp === 'is') return val === 'null' ? current === null || current === undefined : current === val;
        if (cmpOp === 'lt') return typeof current === 'string' && current < val;
        return false;
      });
    };
    const matches = (row: Record<string, unknown>) => filters.every(([c, v]) => row[c] === v) && matchesOr(row);

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
        const [from, to] = range ?? [0, DEFAULT_PAGE_SIZE - 1];
        return { data: matched.slice(from, to + 1), error: null };
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
      if (op === 'upsert') {
        const conflictCols = (onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
        const items = Array.isArray(payload) ? payload : [payload as Record<string, unknown>];
        for (const item of items) {
          const existing = conflictCols.length > 0
            ? rows.find((r) => conflictCols.every((c) => r[c] === item[c]))
            : undefined;
          if (existing) Object.assign(existing, item);
          else rows.push({ id: `${table}-${nextId++}`, ...item });
        }
        return { data: null, error: null };
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
        if (op !== 'insert' && op !== 'upsert' && op !== 'update') op = 'select';
        if (cols) selectedCols = cols.split(',').map((c) => c.trim());
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      range: (from: number, to: number) => {
        range = [from, to];
        return api;
      },
      or: (expr: string) => {
        orClauses = expr.split(',').map((clause) => {
          const [col, cmpOp, ...rest] = clause.split('.');
          return [col, cmpOp as 'is' | 'lt', rest.join('.')];
        });
        return api;
      },
      order: () => api,
      insert: (p: Record<string, unknown> | Record<string, unknown>[]) => {
        op = 'insert';
        payload = p;
        return api;
      },
      upsert: (p: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) => {
        op = 'upsert';
        payload = p;
        onConflict = opts?.onConflict;
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

function ds(id: string, accountId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, account_id: accountId, source_type: 'remote_csv', display_name: id, created_by: 'owner-user',
    source_url: 'https://example.com/inventario.csv', source_filename: null, usage: 'catalog',
    status: 'active', priority: 100, is_primary: false, fallback_policy: 'fallback_on_not_found',
    currency: 'USD', column_mapping: null, row_count: 1, knowledge_document_id: null,
    last_synced_at: null, last_error: null, preview_sample: null, selected_columns: null,
    ...overrides,
  };
}

const REAL_CSV = 'Nombre,Precio,Stock\nProducto A,150,3\n';
const SECRET = 'correct-horse-battery-staple';

function req(secret?: string) {
  const headers = new Headers();
  if (secret !== undefined) headers.set('authorization', `Bearer ${secret}`);
  return new Request('http://localhost/api/internal/data-source-sync', { method: 'POST', headers });
}

// The route's rate limiter is keyed by DATA_SOURCE_SYNC_SOURCE_ID and
// lives in a module-level Map shared across this whole test run — a
// fixed id would let one test's quota bleed into the next's. Giving
// every test its own id keeps each test's rate-limit bucket isolated
// without needing to reset that shared module state.
let testCounter = 0;
let SOURCE_ID = '';

beforeEach(() => {
  testCounter += 1;
  SOURCE_ID = `ds-sheet-${testCounter}`;
  process.env.DATA_SOURCE_SYNC_SECRET = SECRET;
  process.env.DATA_SOURCE_SYNC_SOURCE_ID = SOURCE_ID;
  mocks.supabaseAdmin.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DATA_SOURCE_SYNC_SECRET;
  delete process.env.DATA_SOURCE_SYNC_SOURCE_ID;
});

describe('POST /api/internal/data-source-sync', () => {
  it('not configured (missing env vars) → 503, never a crash or a 401 that implies the endpoint IS wired up', async () => {
    delete process.env.DATA_SOURCE_SYNC_SECRET;
    const res = await POST(req(SECRET));
    expect(res.status).toBe(503);
  });

  it('missing Authorization header → 401', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it('wrong secret (same length) → 401, via timingSafeEqual, never a thrown exception', async () => {
    const res = await POST(req('x'.repeat(SECRET.length)));
    expect(res.status).toBe(401);
  });

  it('wrong secret (different length) → 401, short-circuited before timingSafeEqual (which throws on length mismatch)', async () => {
    const res = await POST(req('short'));
    expect(res.status).toBe(401);
  });

  it('correct secret but configured source id no longer exists → 503, not 404 (this is a config problem, not the caller\'s mistake)', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [] });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(req(SECRET));
    expect(res.status).toBe(503);
  });

  it('configured source is uploaded_csv (not URL-based) → 503, never attempts a refresh', async () => {
    const { supabase } = fakeSupabase({
      ai_data_sources: [ds(SOURCE_ID, 'acct-1', { source_type: 'uploaded_csv', source_url: null })],
    });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(req(SECRET));
    expect(res.status).toBe(503);
  });

  it('configured source has no owning user (created_by null) → 503, never invents an actor', async () => {
    const { supabase } = fakeSupabase({
      ai_data_sources: [ds(SOURCE_ID, 'acct-1', { created_by: null })],
    });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(req(SECRET));
    expect(res.status).toBe(503);
  });

  it('correct secret + valid configured source → 200, refreshes exactly that source, using its OWN account_id/created_by — never anything from the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_CSV, { status: 200 })));
    const { supabase, tables } = fakeSupabase({
      ai_data_sources: [ds(SOURCE_ID, 'acct-1', { created_by: 'owner-user' })],
    });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(req(SECRET));
    const body = (await res.json()) as { success: boolean; data_source_id: string; row_count: number };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data_source_id).toBe(SOURCE_ID);
    expect(body.row_count).toBe(1);
    expect(tables.ai_catalog_products.every((r) => r.account_id === 'acct-1')).toBe(true);
  });

  it('the request body is never consulted for account/user/source — an attacker who knows the secret still cannot pick a target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_CSV, { status: 200 })));
    const { supabase, tables } = fakeSupabase({
      ai_data_sources: [
        ds(SOURCE_ID, 'acct-1', { created_by: 'owner-user' }),
        ds('ds-other', 'acct-victim', { row_count: 99, last_synced_at: 'untouched' }),
      ],
    });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const malicious = new Request('http://localhost/api/internal/data-source-sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'acct-victim', id: 'ds-other', userId: 'attacker' }),
    });
    const res = await POST(malicious);
    const body = (await res.json()) as { data_source_id: string };
    expect(res.status).toBe(200);
    expect(body.data_source_id).toBe(SOURCE_ID); // the configured one, never "ds-other" from the body
    const victim = tables.ai_data_sources.find((r) => r.id === 'ds-other')!;
    expect(victim.row_count).toBe(99);
    expect(victim.last_synced_at).toBe('untouched');
  });

  it('the REAL Apps Script request body ({"event":"inventory_updated"}) triggers a real, completed refresh — HTTP 200 means the sync actually finished, not just "request accepted"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_CSV, { status: 200 })));
    const { supabase } = fakeSupabase({ ai_data_sources: [ds(SOURCE_ID, 'acct-1', { created_by: 'owner-user' })] });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const appsScriptRequest = new Request('http://localhost/api/internal/data-source-sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'inventory_updated' }),
    });
    const res = await POST(appsScriptRequest);
    const body = (await res.json()) as { success: boolean; row_count: number; last_synced_at: string };
    // This endpoint is synchronous — `refreshDataSource()` is awaited
    // to completion BEFORE this response is built, so 200 here means
    // the import genuinely finished (real row_count/last_synced_at in
    // the body), never just "the notification was logged." The
    // `event` field itself was never read — it's accepted-but-ignored,
    // the one configured source id is always what gets refreshed.
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.row_count).toBe(1);
    expect(body.last_synced_at).toBeTruthy();
  });

  it('a second concurrent sync call → 409 (H-5\'s own refresh lock applies here identically), never a duplicate import', async () => {
    const { supabase } = fakeSupabase({
      ai_data_sources: [
        ds(SOURCE_ID, 'acct-1', { refresh_started_at: new Date().toISOString(), created_by: 'owner-user' }),
      ],
    });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(req(SECRET));
    expect(res.status).toBe(409);
  });

  it('an invalid/HTML sheet response → 422, and the previous good inventory is left untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><html></html>', { status: 200 })));
    const { supabase, tables } = fakeSupabase({
      ai_data_sources: [ds(SOURCE_ID, 'acct-1', { created_by: 'owner-user', row_count: 42, last_synced_at: 'yesterday' })],
    });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(req(SECRET));
    expect(res.status).toBe(422);
    expect(tables.ai_data_sources[0].row_count).toBe(42);
    expect(tables.ai_data_sources[0].last_synced_at).toBe('yesterday');
    expect(tables.ai_data_sources[0].status).toBe('error');
  });

  it('a plain DataSourceError (not NotFound/RefreshInProgress — e.g. a configured source with no URL) → 422 with that error\'s own message', async () => {
    const { supabase } = fakeSupabase({
      // remote_csv passes the route's own source_type gate, but has no
      // URL to refetch — doRefreshDataSource's own
      // `throw new DataSourceError('This data source has no URL to refresh.')`,
      // a plain DataSourceError, never one of its two subclasses.
      ai_data_sources: [ds(SOURCE_ID, 'acct-1', { created_by: 'owner-user', source_url: null })],
    });
    mocks.supabaseAdmin.mockReturnValue(supabase);

    const res = await POST(req(SECRET));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(422);
    expect(body.error).toBe('This data source has no URL to refresh.');
  });

  it('an unexpected (non-DataSourceError) exception from refreshDataSource → 500 with a generic body, never the real error message or any internal detail', async () => {
    const { supabase } = fakeSupabase({
      ai_data_sources: [ds(SOURCE_ID, 'acct-1', { created_by: 'owner-user' })],
    });
    mocks.supabaseAdmin.mockReturnValue(supabase);
    mocks.refreshDataSource.mockRejectedValueOnce(
      new Error('internal: pg connection refused at postgres://user:secret@10.0.0.5:5432/db'),
    );

    const res = await POST(req(SECRET));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Internal server error' });
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('10.0.0.5');
  });

  it('never echoes the secret or the Authorization header back in any response body', async () => {
    const res1 = await POST(req('wrong-but-same-length-01'));
    const text1 = await res1.text();
    expect(text1).not.toContain(SECRET);
    expect(text1).not.toContain('wrong-but-same-length-01');

    const { supabase } = fakeSupabase({ ai_data_sources: [ds(SOURCE_ID, 'acct-1', { created_by: 'owner-user' })] });
    mocks.supabaseAdmin.mockReturnValue(supabase);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_CSV, { status: 200 })));
    const res2 = await POST(req(SECRET));
    const text2 = await res2.text();
    expect(text2).not.toContain(SECRET);
  });
});
