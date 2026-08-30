import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET/POST /api/integrations/catalog — never had a test file before
// (Catálogo/Integrations hardening phase). Covers auth, multi-tenancy,
// and that account_id/created_by are always server-resolved, never
// taken from the request body.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

import { GET, POST } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

/** Generic in-memory fake for `catalog_integrations` — chainable AND
 *  directly awaitable (implements `.then`), matching every call shape
 *  the real service code uses. Real column projection via `.select()`
 *  so a test can't pass by accident on a fake that ignores it. */
function fakeSupabase(seed: Record<string, unknown>[] = []) {
  const rows: Record<string, unknown>[] = seed.map((r) => ({ ...r }));
  let nextId = 1;

  function builder() {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Record<string, unknown> | undefined;
    const filters: [string, unknown][] = [];
    let single: 'one' | null = null;
    let selectedCols: string[] | null = null;
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
        return { data: matched, error: null };
      }
      if (op === 'insert') {
        const inserted = {
          id: `int-${nextId++}`,
          created_at: 'now',
          updated_at: 'now',
          last_test_at: null,
          last_test_ok: null,
          last_error: null,
          status: 'active',
          priority: 100,
          ...payload,
        };
        rows.push(inserted);
        const returned = project(inserted);
        return single === 'one' ? { data: returned, error: null } : { data: [returned], error: null };
      }
      if (op === 'update') {
        const matched = rows.filter(matches);
        for (const row of matched) Object.assign(row, payload);
        const returned = matched.map(project);
        return { data: returned, error: null };
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
      insert: (p: Record<string, unknown>) => {
        op = 'insert';
        payload = p;
        return api;
      },
      update: (p: Record<string, unknown>) => {
        op = 'update';
        payload = p;
        return api;
      },
      single: () => {
        single = 'one';
        return Promise.resolve(execute());
      },
      maybeSingle: () => Promise.resolve(execute()),
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
    encrypted_secret: 'enc:original-secret',
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

beforeEach(() => {
  mocks.requireRole.mockReset();
  __resetRateLimitForTests();
});

describe('GET /api/integrations/catalog', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns only the caller\'s own account integrations — never another account\'s', async () => {
    const { supabase } = fakeSupabase([
      integration('int-mine', 'acct-1'),
      integration('int-other', 'acct-2'),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET();
    const body = (await res.json()) as { integrations: { id: string }[] };
    expect(res.status).toBe(200);
    expect(body.integrations.map((i) => i.id)).toEqual(['int-mine']);
  });

  it('never exposes encrypted_secret in the response', async () => {
    const { supabase } = fakeSupabase([integration('int-1', 'acct-1')]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET();
    const body = (await res.json()) as { integrations: Record<string, unknown>[] };
    expect(body.integrations[0].encrypted_secret).toBeUndefined();
  });
});

function postRequest(body: unknown) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/integrations/catalog', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await POST(postRequest({}));
    expect(res.status).toBe(403);
  });

  it('rejects a provider other than "budun"', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postRequest({ provider: 'other', display_name: 'X', base_url: 'https://x.com', secret: 's' }));
    expect(res.status).toBe(400);
  });

  it('requires display_name, base_url and secret', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postRequest({ provider: 'budun' }));
    expect(res.status).toBe(400);
  });

  it('creates the integration under the SERVER-RESOLVED account_id, ignoring any account_id the client sends', async () => {
    const { supabase, rows } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-real', userId: 'user-1' });

    const res = await POST(
      postRequest({
        provider: 'budun',
        display_name: 'Mi ERP',
        base_url: 'https://erp.example.com',
        secret: 'super-secret',
        // A client trying to inject a foreign account_id — must be
        // ignored entirely; saveCatalogIntegration doesn't even accept
        // this field from the route.
        account_id: 'acct-attacker',
      }),
    );
    const body = (await res.json()) as { success: boolean; integration: { account_id: string } };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.integration.account_id).toBe('acct-real');
    expect(rows[0].account_id).toBe('acct-real');
    expect(rows.some((r) => r.account_id === 'acct-attacker')).toBe(false);
  });

  it('never echoes the plaintext or encrypted secret back in the response', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(
      postRequest({ provider: 'budun', display_name: 'X', base_url: 'https://x.com', secret: 'super-secret-value' }),
    );
    const text = await res.text();
    expect(text).not.toContain('super-secret-value');
    expect(text).not.toContain('encrypted_secret');
  });

  it('creating a new primary demotes any other primary integration on the SAME account only', async () => {
    const { supabase, rows } = fakeSupabase([
      integration('int-old-primary', 'acct-1', { is_primary: true }),
      integration('int-other-account-primary', 'acct-2', { is_primary: true }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    await POST(
      postRequest({ provider: 'budun', display_name: 'New', base_url: 'https://new.example.com', secret: 's', is_primary: true }),
    );

    const oldPrimary = rows.find((r) => r.id === 'int-old-primary')!;
    const otherAccount = rows.find((r) => r.id === 'int-other-account-primary')!;
    expect(oldPrimary.is_primary).toBe(false);
    expect(otherAccount.is_primary).toBe(true); // untouched — different account
  });
});
