import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/integrations/catalog/[id]/test — never had a test file
// before (Catálogo/Integrations hardening phase). Out of the E1/E2
// scope (this route/service function wasn't modified — it already
// correctly treats a missing/foreign id as "not found" via
// maybeSingle()), but it had zero HTTP-level coverage.
// ============================================================

// Identity crypto — same convention as integrations.test.ts — the
// stored ciphertext just needs to decrypt back to a usable secret for
// BudunClient; its exact bytes are never asserted here.
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}));

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

import { POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

/** Same generic fake as ../route.test.ts — real column projection,
 *  select/update/maybeSingle/then. */
function fakeSupabase(seed: Record<string, unknown>[] = []) {
  const rows: Record<string, unknown>[] = seed.map((r) => ({ ...r }));

  function builder() {
    let op: 'select' | 'update' = 'select';
    let payload: Record<string, unknown> | undefined;
    const filters: [string, unknown][] = [];
    let single: 'maybe' | null = null;
    let selectedCols: string[] | null = null;
    const matches = (row: Record<string, unknown>) => filters.every(([c, v]) => row[c] === v);

    function project<T extends Record<string, unknown>>(row: T): T {
      if (!selectedCols) return row;
      const out = {} as Record<string, unknown>;
      for (const col of selectedCols) out[col] = row[col];
      return out as T;
    }

    function execute(): { data: unknown; error: unknown } {
      const matched = rows.filter(matches);
      if (op === 'select') {
        const projected = matched.map(project);
        if (single === 'maybe') return { data: projected[0] ?? null, error: null };
        return { data: projected, error: null };
      }
      if (op === 'update') {
        for (const row of matched) Object.assign(row, payload);
        return { data: matched.map(project), error: null };
      }
      return { data: null, error: null };
    }

    const api = {
      select: (cols?: string) => {
        if (op !== 'update') op = 'select';
        if (cols) selectedCols = cols.split(',').map((c) => c.trim());
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      update: (p: Record<string, unknown>) => {
        op = 'update';
        payload = p;
        return api;
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
    supabase: { from: () => builder() } as never,
    rows,
  };
}

function integration(id: string, accountId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    account_id: accountId,
    provider: 'budun',
    display_name: id,
    base_url: 'https://erp.example.com',
    app_key: null,
    encrypted_secret: 'enc:real-secret',
    scopes: ['catalog:read'],
    status: 'active',
    priority: 100,
    is_primary: false,
    last_test_at: null,
    last_test_ok: null,
    last_error: null,
    created_at: 'then',
    updated_at: 'then',
    ...overrides,
  };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function okFetchResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response;
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  __resetRateLimitForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/integrations/catalog/[id]/test', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('int-1'));
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('int-1'));
    expect(res.status).toBe(403);
  });

  it('runs a real connection test against the caller\'s own integration and persists the result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okFetchResponse({ products: [] })));
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1')]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('int-1'));
    const body = (await res.json()) as { ok: boolean; message: string; latencyMs: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(rows[0].last_test_ok).toBe(true);
    expect(rows[0].status).toBe('active');
  });

  it('MULTI-TENANT: testing another account\'s integration id reports "not found", never runs the victim\'s real connection test', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { supabase, rows } = fakeSupabase([integration('int-victim', 'acct-victim', { last_test_ok: null })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('int-victim'));
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(res.status).toBe(200); // this endpoint's own established contract: always 200, structured result
    expect(body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled(); // never even attempted to reach the victim's ERP
    expect(rows[0].last_test_ok).toBeNull(); // victim's row untouched
  });

  it('never exposes the secret (plaintext or ciphertext) in the response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okFetchResponse({ products: [] })));
    const { supabase } = fakeSupabase([integration('int-1', 'acct-1', { encrypted_secret: 'enc:super-secret-value' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('int-1'));
    const text = await res.text();
    expect(text).not.toContain('super-secret-value');
    expect(text).not.toContain('encrypted_secret');
  });

  it('a real connection failure is reported ok:false and persisted, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1', { status: 'active' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('int-1'));
    const body = (await res.json()) as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(rows[0].last_test_ok).toBe(false);
    expect(rows[0].status).toBe('error');
  });
});
