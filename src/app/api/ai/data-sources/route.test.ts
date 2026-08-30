import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET/POST /api/ai/data-sources — FASE 4 (blindaje de Data Sources +
// corrección de SSRF real, Bug #1). Never had a test file before.
//
// `node:dns/promises`'s `lookup` is mocked so every SSRF scenario below
// is deterministic and network-free — a literal IP (127.0.0.1,
// 169.254.169.254, ...) never even reaches DNS, but a hostname needs a
// controlled resolved address to test reliably in any environment,
// including one with no real network access. `fetch` is stubbed the
// same way. Everything else (parsing, persistence, multi-tenancy) runs
// against the real service.ts functions and a fake Supabase.
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

import { GET, POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';

/** Same generic in-memory multi-table fake used throughout FASE 3/4 —
 *  real column projection, real chain shapes (select/insert/update/
 *  delete, each chainable with .eq()/.select()/.single()/.maybeSingle(),
 *  awaitable at any point). */
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

function postFormRequest(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return new Request('http://localhost/api/ai/data-sources', { method: 'POST', body: fd });
}

const REAL_CSV = 'Nombre,Precio,Stock\nProducto A,100,5\n';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.dnsLookup.mockReset();
});

describe('GET /api/ai/data-sources', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns only the authenticated account\'s data sources', async () => {
    const { supabase } = fakeSupabase({
      ai_data_sources: [
        { id: 'ds-a', account_id: 'acct-A', source_type: 'uploaded_csv', display_name: 'De A', is_primary: false, priority: 100, usage: 'knowledge', status: 'active', fallback_policy: 'fallback_on_not_found', currency: 'USD' },
      ],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET();
    const body = (await res.json()) as { data_sources: { id: string }[] };
    expect(res.status).toBe(200);
    expect(body.data_sources).toHaveLength(1);
    expect(body.data_sources[0].id).toBe('ds-a');
  });

  it('MULTI-TENANT: never reveals another account\'s data sources', async () => {
    const { supabase } = fakeSupabase({
      ai_data_sources: [
        { id: 'ds-b', account_id: 'acct-B', source_type: 'uploaded_csv', display_name: 'Secreto de B', is_primary: false, priority: 100, usage: 'knowledge', status: 'active', fallback_policy: 'fallback_on_not_found', currency: 'USD' },
      ],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET();
    const body = (await res.json()) as { data_sources: unknown[] };
    expect(body.data_sources).toEqual([]);
  });
});

describe('POST /api/ai/data-sources — validation & normal creation', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await POST(postFormRequest({ source_type: 'uploaded_csv', display_name: 'x' }));
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await POST(postFormRequest({ source_type: 'uploaded_csv', display_name: 'x' }));
    expect(res.status).toBe(403);
  });

  it('missing display_name → 400', async () => {
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    const res = await POST(postFormRequest({ source_type: 'uploaded_csv', display_name: '' }));
    expect(res.status).toBe(400);
  });

  it('invalid usage → 400', async () => {
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    const res = await POST(postFormRequest({ source_type: 'uploaded_csv', display_name: 'x', usage: 'not-a-real-usage' }));
    expect(res.status).toBe(400);
  });

  it('invalid source_type → 400', async () => {
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    const res = await POST(postFormRequest({ source_type: 'ftp_thing', display_name: 'x' }));
    expect(res.status).toBe(400);
  });

  it('creates an uploaded_csv source for real — no DNS/fetch involved at all', async () => {
    const { supabase, tables } = fakeSupabase({ accounts: [{ id: 'acct-real', default_currency: 'DOP' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-real', userId: 'user-1' });

    const res = await POST(postFormRequest({
      source_type: 'uploaded_csv',
      display_name: 'Inventario subido',
      usage: 'catalog',
      file: new File([REAL_CSV], 'inventario.csv', { type: 'text/csv' }),
      account_id: 'acct-attacker-supplied', // never read by the route
    }));
    const body = (await res.json()) as { success: boolean; data_source: { id: string; account_id: string; currency: string } };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data_source.account_id).toBe('acct-real');
    expect(body.data_source.currency).toBe('DOP');
    expect(mocks.dnsLookup).not.toHaveBeenCalled();
    expect(tables.ai_catalog_products.some((p) => p.name === 'Producto A')).toBe(true);
  });

  it('creates a remote_csv source for a legitimate public URL', async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]); // a real, public, non-blocked address
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_CSV, { status: 200 })));
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postFormRequest({
      source_type: 'remote_csv',
      display_name: 'CSV remoto',
      usage: 'knowledge',
      url: 'https://example.com/inventario.csv',
    }));
    const body = (await res.json()) as { success: boolean };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    vi.unstubAllGlobals();
  });

  it('creates a google_sheets source for a legitimate public sheet URL', async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: '142.250.0.100', family: 4 }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_CSV, { status: 200 })));
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postFormRequest({
      source_type: 'google_sheets',
      display_name: 'Sheet público',
      usage: 'knowledge',
      url: 'https://docs.google.com/spreadsheets/d/abc/export?format=csv',
    }));
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });
});

describe('POST /api/ai/data-sources — BUG #1 (SSRF) fix', () => {
  const attempts: { label: string; url: string }[] = [
    { label: 'loopback literal', url: 'http://127.0.0.1/x.csv' },
    { label: 'localhost', url: 'http://localhost/x.csv' },
    { label: 'cloud metadata address', url: 'http://169.254.169.254/latest/meta-data/' },
    { label: 'RFC1918 private (10.x)', url: 'http://10.0.0.5/x.csv' },
    { label: 'RFC1918 private (192.168.x)', url: 'http://192.168.1.1/x.csv' },
    { label: 'RFC1918 private (172.16-31.x)', url: 'http://172.20.0.5/x.csv' },
  ];

  for (const { label, url } of attempts) {
    it(`remote_csv with ${label} (${url}) is rejected BEFORE any fetch happens`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { supabase, tables } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

      const res = await POST(postFormRequest({ source_type: 'remote_csv', display_name: 'x', url }));
      expect(res.status).toBe(422);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(tables.ai_data_sources ?? []).toHaveLength(0);
      vi.unstubAllGlobals();
    });
  }

  it('rejects file:// — not http(s), never even attempts DNS/fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postFormRequest({ source_type: 'remote_csv', display_name: 'x', url: 'file:///etc/passwd' }));
    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.dnsLookup).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a hostname that RESOLVES to a private address is rejected too — not just literal IPs in the URL', async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postFormRequest({ source_type: 'remote_csv', display_name: 'x', url: 'http://internal-service.example/x.csv' }));
    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a redirect chain to a blocked address is also rejected — the hop is re-validated, not just the original URL', async () => {
    mocks.dnsLookup.mockImplementation(async (hostname: string) => {
      if (hostname === 'public-redirector.example') return [{ address: '93.184.216.34', family: 4 }];
      throw new Error('unexpected hostname in test');
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) === 'http://public-redirector.example/x.csv') {
        return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
      }
      throw new Error('should never reach the redirect target');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postFormRequest({ source_type: 'remote_csv', display_name: 'x', url: 'http://public-redirector.example/x.csv' }));
    expect(res.status).toBe(422);
    // The redirector itself WAS fetched once (it's public) — only the
    // blocked redirect target must never be requested.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
