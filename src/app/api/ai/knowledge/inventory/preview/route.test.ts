import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/ai/knowledge/inventory/preview — FASE 3. Never had a test
// file before. This route never persists anything — it only parses and
// previews — so these tests run the REAL parsers (`parseInventoryFile`,
// `parseSheetCsv`) against real small CSV text instead of mocking them
// out; the only things mocked are auth and the network fetch for the
// Google Sheets URL path (the one genuinely external call this route
// makes).
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

import { POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';

/** Same generic fake as ../../route.test.ts — only `accounts` is used
 *  here (for accountDefaultCurrency, which runs for real). */
function fakeSupabase(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

  function ensure(name: string) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    const rows = ensure(table);
    const matches = (row: Record<string, unknown>) => filters.every(([c, v]) => row[c] === v);
    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      maybeSingle: async () => {
        const matched = rows.filter(matches);
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

function multipartRequest(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return new Request('http://localhost/api/ai/knowledge/inventory/preview', { method: 'POST', body: fd });
}

function jsonRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/knowledge/inventory/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const REAL_CSV = 'Nombre,Precio,Stock\nProducto A,100,5\nProducto B,200,0\n';
// A header plus one row of entirely-empty cells — NOT the same as a
// truly header-only file (rows.length < 2 would trip a different, less
// specific error). This exercises buildInventory's second, more
// specific guard: "there are rows, but none of them have real data".
const HEADER_ONLY_CSV = 'Nombre,Precio,Stock\n,,\n';

beforeEach(() => {
  mocks.requireRole.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/ai/knowledge/inventory/preview', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await POST(multipartRequest({ file: new File([REAL_CSV], 'inventario.csv', { type: 'text/csv' }) }));
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await POST(multipartRequest({ file: new File([REAL_CSV], 'inventario.csv', { type: 'text/csv' }) }));
    expect(res.status).toBe(403);
  });

  it('multipart without a file field → 400', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    const res = await POST(multipartRequest({ title: 'sin archivo' }));
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported file extension — 400', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    const res = await POST(multipartRequest({ file: new File(['x'], 'catalogo.pdf', { type: 'application/pdf' }) }));
    expect(res.status).toBe(400);
  });

  it('previews a real CSV — detects columns and returns real sample rows, saving nothing', async () => {
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'DOP' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(multipartRequest({ file: new File([REAL_CSV], 'inventario.csv', { type: 'text/csv' }) }));
    const body = (await res.json()) as {
      preview: { sample: Record<string, string>[]; detected: Record<string, string | null> };
      metadata: { rows: number; currency: string; source: string };
    };
    expect(res.status).toBe(200);
    expect(body.metadata.source).toBe('csv');
    expect(body.metadata.currency).toBe('DOP'); // the account's real default_currency, not a hardcoded one
    expect(body.metadata.rows).toBe(2);
    // Real contract (inventory-parser.ts's buildInventory): detected
    // column names are matched and returned LOWER-CASED, never the
    // original header casing.
    expect(body.preview.detected.name).toBe('nombre');
    expect(body.preview.detected.price).toBe('precio');
    expect(body.preview.sample.some((r) => Object.values(r).includes('Producto A'))).toBe(true);
  });

  it('falls back to USD when the account has no default_currency row', async () => {
    const { supabase } = fakeSupabase({ accounts: [] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-sin-cuenta', userId: 'user-1' });

    const res = await POST(multipartRequest({ file: new File([REAL_CSV], 'inventario.csv', { type: 'text/csv' }) }));
    const body = (await res.json()) as { metadata: { currency: string } };
    expect(body.metadata.currency).toBe('USD');
  });

  it('a file with headers but zero data rows is rejected with 422 (real contract: inventory-parser.ts requires at least one data row)', async () => {
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(multipartRequest({ file: new File([HEADER_ONLY_CSV], 'vacio.csv', { type: 'text/csv' }) }));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(422);
    expect(body.error).toContain('No data rows found after the header');
  });

  it('rejects a JSON body with no url — 400', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it('rejects a non-Google-Sheets url — 400, never fetches it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(jsonRequest({ url: 'https://example.com/not-a-sheet.csv' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('previews a real Google Sheets CSV export (fetch mocked, parsing real)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(REAL_CSV, { status: 200 })));
    const { supabase } = fakeSupabase({ accounts: [{ id: 'acct-1', default_currency: 'USD' }] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(jsonRequest({ url: 'https://docs.google.com/spreadsheets/d/abc/export?format=csv' }));
    const body = (await res.json()) as { metadata: { source: string; rows: number } };
    expect(res.status).toBe(200);
    expect(body.metadata.source).toBe('sheet');
    expect(body.metadata.rows).toBe(2);
  });

  it('a Sheets URL that returns HTML (unpublished sheet) → 422, not a false-positive preview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><html>...</html>', { status: 200 })));
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(jsonRequest({ url: 'https://docs.google.com/spreadsheets/d/abc/export?format=csv' }));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(422);
    expect(body.error).toContain('Publish your sheet');
  });

  it('a fetch failure (network error) → 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(jsonRequest({ url: 'https://docs.google.com/spreadsheets/d/abc/export?format=csv' }));
    expect(res.status).toBe(502);
  });

  it('a non-2xx fetch response → 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(jsonRequest({ url: 'https://docs.google.com/spreadsheets/d/abc/export?format=csv' }));
    expect(res.status).toBe(502);
  });

  it('MULTI-TENANT: each account\'s preview reflects ITS OWN default currency, never another account\'s', async () => {
    const { supabase: supabaseA } = fakeSupabase({
      accounts: [{ id: 'acct-A', default_currency: 'DOP' }, { id: 'acct-B', default_currency: 'EUR' }],
    });
    mocks.requireRole.mockResolvedValue({ supabase: supabaseA, accountId: 'acct-A', userId: 'user-a' });
    const resA = await POST(multipartRequest({ file: new File([REAL_CSV], 'x.csv', { type: 'text/csv' }) }));
    const bodyA = (await resA.json()) as { metadata: { currency: string } };
    expect(bodyA.metadata.currency).toBe('DOP');

    const { supabase: supabaseB } = fakeSupabase({
      accounts: [{ id: 'acct-A', default_currency: 'DOP' }, { id: 'acct-B', default_currency: 'EUR' }],
    });
    mocks.requireRole.mockResolvedValue({ supabase: supabaseB, accountId: 'acct-B', userId: 'user-b' });
    const resB = await POST(multipartRequest({ file: new File([REAL_CSV], 'x.csv', { type: 'text/csv' }) }));
    const bodyB = (await resB.json()) as { metadata: { currency: string } };
    expect(bodyB.metadata.currency).toBe('EUR');
  });
});
