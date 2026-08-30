import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// PATCH/DELETE /api/integrations/catalog/[id] — never had a test file
// before (Catálogo/Integrations hardening phase).
//
// Pins two real bugs found during the Catálogo/Inventory audit and
// fixed in this same pass:
//
//   BUG E1 — saveCatalogIntegration() used to clear is_primary on
//   EVERY integration of the account BEFORE checking whether the
//   PATCH's target `id` actually existed for that account. A PATCH
//   with a wrong/foreign/deleted id + is_primary:true still failed
//   overall, but the account's real primary integration had already
//   been demoted with no rollback. Now fixed: existence is verified
//   FIRST, before any is_primary mutation.
//
//   BUG E2 — PATCH/DELETE of a nonexistent or cross-tenant id fell
//   through to toErrorResponse's generic 500, instead of a 404. Now
//   fixed via CatalogIntegrationNotFoundError.
// ============================================================

// Identity crypto in tests — same convention already used in
// integrations.test.ts/config.test.ts — lets assertions check the
// exact stored ciphertext without depending on real AES internals.
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

import { PATCH, DELETE } from './route';
import { GET as GET_LIST } from '../route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

/** Generic in-memory fake for `catalog_integrations` with REAL column
 *  projection (a fake that ignored `.select(cols)` could make a test
 *  pass even against broken code — see FASE 3/4 precedent). Supports
 *  the exact call shapes integrations.ts issues: select+eq*+maybeSingle
 *  (existence checks), update+eq*+select+single, delete+eq*. */
function fakeSupabase(seed: Record<string, unknown>[] = []) {
  const rows: Record<string, unknown>[] = seed.map((r) => ({ ...r }));

  function builder() {
    let op: 'select' | 'update' | 'delete' = 'select';
    let payload: Record<string, unknown> | undefined;
    const filters: [string, unknown][] = [];
    let single: 'one' | 'maybe' | null = null;
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
        if (single === 'one') return projected[0] ? { data: projected[0], error: null } : { data: null, error: { message: 'no rows' } };
        if (single === 'maybe') return { data: projected[0] ?? null, error: null };
        return { data: projected, error: null };
      }
      if (op === 'update') {
        // Test hook: a row whose id is exactly 'int-db-error' simulates
        // a genuine backend failure on the UPDATE step itself (distinct
        // from "not found") — must still surface as a real error, never
        // silently reinterpreted as 404.
        if (matched.some((r) => r.id === 'int-db-error')) {
          return { data: null, error: { message: 'connection reset' } };
        }
        for (const row of matched) Object.assign(row, payload);
        const projected = matched.map(project);
        if (single === 'one') return projected[0] ? { data: projected[0], error: null } : { data: null, error: { message: 'no rows' } };
        return { data: projected, error: null };
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
        if (op !== 'update') op = 'select';
        if (cols) selectedCols = cols.split(',').map((c) => c.trim());
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      // No-op passthrough — real ordering is irrelevant to what these
      // tests assert, but listCatalogIntegrations() (used by the
      // shared GET_LIST round-trip test below) always chains `.order()`
      // twice, so the fake must at least accept the call.
      order: () => api,
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

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown) {
  return new Request('http://localhost', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  __resetRateLimitForTests();
});

describe('PATCH /api/integrations/catalog/[id]', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await PATCH(patchRequest({}), params('int-1'));
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await PATCH(patchRequest({}), params('int-1'));
    expect(res.status).toBe(403);
  });

  it('updates the caller\'s own integration', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1', { display_name: 'Old name' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ display_name: 'New name' }), params('int-1'));
    const body = (await res.json()) as { success: boolean; integration: { display_name: string } };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.integration.display_name).toBe('New name');
    expect(rows[0].display_name).toBe('New name');
  });

  it('partial update: rotating only the secret leaves base_url/app_key/is_primary/scopes untouched', async () => {
    const { supabase, rows } = fakeSupabase([
      integration('int-1', 'acct-1', {
        base_url: 'https://original.example.com',
        app_key: 'original-app-key',
        is_primary: true,
        scopes: ['catalog:read', 'catalog:media:read'],
        encrypted_secret: 'enc:original-secret',
      }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ secret: 'rotated-secret' }), params('int-1'));
    expect(res.status).toBe(200);
    expect(rows[0].encrypted_secret).toBe('enc:rotated-secret');
    expect(rows[0].base_url).toBe('https://original.example.com');
    expect(rows[0].app_key).toBe('original-app-key');
    expect(rows[0].is_primary).toBe(true);
    expect(rows[0].scopes).toEqual(['catalog:read', 'catalog:media:read']);
  });

  it('never echoes the secret (plaintext or ciphertext) back in the response', async () => {
    const { supabase } = fakeSupabase([integration('int-1', 'acct-1')]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ secret: 'brand-new-secret-value' }), params('int-1'));
    const text = await res.text();
    expect(text).not.toContain('brand-new-secret-value');
    expect(text).not.toContain('encrypted_secret');
  });

  it('BUG E2 FIX: PATCH of a non-existent id → 404, not 500', async () => {
    const { supabase } = fakeSupabase([]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ display_name: 'X' }), params('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('BUG E2 FIX / MULTI-TENANT: PATCH of another account\'s id → 404, and that integration is left completely unmodified', async () => {
    const { supabase, rows } = fakeSupabase([
      integration('int-victim', 'acct-victim', { display_name: 'Victim ERP', base_url: 'https://victim.example.com' }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await PATCH(patchRequest({ display_name: 'Hacked' }), params('int-victim'));
    expect(res.status).toBe(404);
    expect(rows[0].display_name).toBe('Victim ERP');
    expect(rows[0].base_url).toBe('https://victim.example.com');
  });

  it('BUG E1 FIX: PATCH of a non-existent id with is_primary:true leaves the account\'s REAL primary integration untouched', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-real-primary', 'acct-1', { is_primary: true })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ is_primary: true }), params('does-not-exist'));
    expect(res.status).toBe(404);
    // This is the exact bug: the pre-fix code cleared is_primary on
    // every row of the account BEFORE discovering the target id didn't
    // exist. Against the pre-fix code this assertion would fail.
    expect(rows[0].is_primary).toBe(true);
  });

  it('BUG E1 FIX / MULTI-TENANT: PATCH of another account\'s id with is_primary:true leaves BOTH the caller\'s real primary AND the other account\'s integration untouched', async () => {
    const { supabase, rows } = fakeSupabase([
      integration('int-mine-primary', 'acct-1', { is_primary: true }),
      integration('int-victim', 'acct-victim', { is_primary: false, display_name: 'Victim ERP' }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ is_primary: true }), params('int-victim'));
    expect(res.status).toBe(404);

    const mine = rows.find((r) => r.id === 'int-mine-primary')!;
    const victim = rows.find((r) => r.id === 'int-victim')!;
    expect(mine.is_primary).toBe(true); // caller's real primary — never demoted
    expect(victim.is_primary).toBe(false); // victim's row — completely untouched
    expect(victim.display_name).toBe('Victim ERP');
  });

  it('promoting a REAL, owned integration to primary still correctly demotes the account\'s previous primary (positive path, unaffected by the fix)', async () => {
    const { supabase, rows } = fakeSupabase([
      integration('int-old-primary', 'acct-1', { is_primary: true }),
      integration('int-new-primary', 'acct-1', { is_primary: false }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ is_primary: true }), params('int-new-primary'));
    expect(res.status).toBe(200);
    expect(rows.find((r) => r.id === 'int-old-primary')!.is_primary).toBe(false);
    expect(rows.find((r) => r.id === 'int-new-primary')!.is_primary).toBe(true);
  });

  it('a genuine backend/Supabase error during the update itself is NOT converted into a 404', async () => {
    const { supabase } = fakeSupabase([integration('int-db-error', 'acct-1')]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ display_name: 'X' }), params('int-db-error'));
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(500);
  });

  it('never trusts an account_id sent in the PATCH body', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1')]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ display_name: 'X', account_id: 'acct-attacker' }), params('int-1'));
    expect(res.status).toBe(200);
    expect(rows[0].account_id).toBe('acct-1');
  });
});

// ============================================================
// BUG STATUS — Enable/Disable didn't persist: the PATCH route never
// read body.status, SaveCatalogIntegrationInput had no `status` field,
// and saveCatalogIntegration() never included it in the UPDATE payload.
// A toggle click got a real 200 back with the row's UNCHANGED status.
// ============================================================
describe('PATCH /api/integrations/catalog/[id] — status (Enable/Disable)', () => {
  it('status: "disabled" → 200 and the row is really persisted as disabled', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1', { status: 'active' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ status: 'disabled' }), params('int-1'));
    const body = (await res.json()) as { success: boolean; integration: { status: string } };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.integration.status).toBe('disabled');
    expect(rows[0].status).toBe('disabled');
  });

  it('status: "active" → 200 and the row is really persisted as active', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1', { status: 'disabled' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ status: 'active' }), params('int-1'));
    expect(res.status).toBe(200);
    expect(rows[0].status).toBe('active');
  });

  it('a subsequent GET (list) reflects the persisted status — not just the PATCH response', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1', { status: 'active' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const patchRes = await PATCH(patchRequest({ status: 'disabled' }), params('int-1'));
    expect(patchRes.status).toBe(200);
    expect(rows[0].status).toBe('disabled'); // sanity: really persisted before we even call GET

    const getRes = await GET_LIST();
    const getBody = (await getRes.json()) as { integrations: { id: string; status: string }[] };
    expect(getRes.status).toBe(200);
    expect(getBody.integrations.find((i) => i.id === 'int-1')?.status).toBe('disabled');
  });

  it('a status-only PATCH does not modify base_url/app_key/scopes/is_primary/priority/encrypted_secret', async () => {
    const { supabase, rows } = fakeSupabase([
      integration('int-1', 'acct-1', {
        status: 'active',
        base_url: 'https://original.example.com',
        app_key: 'original-app-key',
        scopes: ['catalog:read', 'catalog:media:read'],
        is_primary: true,
        priority: 42,
        encrypted_secret: 'enc:original-secret',
      }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ status: 'disabled' }), params('int-1'));
    expect(res.status).toBe(200);
    expect(rows[0].status).toBe('disabled');
    expect(rows[0].base_url).toBe('https://original.example.com');
    expect(rows[0].app_key).toBe('original-app-key');
    expect(rows[0].scopes).toEqual(['catalog:read', 'catalog:media:read']);
    expect(rows[0].is_primary).toBe(true);
    expect(rows[0].priority).toBe(42);
    expect(rows[0].encrypted_secret).toBe('enc:original-secret');
  });

  it('status change on a non-existent id → 404, nothing written', async () => {
    const { supabase } = fakeSupabase([]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ status: 'disabled' }), params('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('MULTI-TENANT: status change on another account\'s id → 404, victim\'s status left untouched', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-victim', 'acct-victim', { status: 'active' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await PATCH(patchRequest({ status: 'disabled' }), params('int-victim'));
    expect(res.status).toBe(404);
    expect(rows[0].status).toBe('active');
  });

  it('status: "error" is rejected with 400 — that value is reserved for testCatalogIntegration()\'s own result, never client-settable', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1', { status: 'active' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ status: 'error' }), params('int-1'));
    expect(res.status).toBe(400);
    expect(rows[0].status).toBe('active'); // unchanged — rejected before any write
  });

  it('an invalid status value ("banana") is rejected with 400, nothing written', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1', { status: 'active' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ status: 'banana' }), params('int-1'));
    expect(res.status).toBe(400);
    expect(rows[0].status).toBe('active');
  });

  it('a genuine backend/Supabase error during a status UPDATE is NOT converted into a 404 or a false 200', async () => {
    const { supabase } = fakeSupabase([integration('int-db-error', 'acct-1', { status: 'active' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ status: 'disabled' }), params('int-db-error'));
    expect(res.status).toBe(500);
  });

  it('a status-only PATCH response never exposes encrypted_secret or the secret', async () => {
    const { supabase } = fakeSupabase([integration('int-1', 'acct-1', { status: 'active', encrypted_secret: 'enc:super-secret-value' })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PATCH(patchRequest({ status: 'disabled' }), params('int-1'));
    const text = await res.text();
    expect(text).not.toContain('super-secret-value');
    expect(text).not.toContain('encrypted_secret');
  });
});

describe('DELETE /api/integrations/catalog/[id]', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('int-1'));
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('int-1'));
    expect(res.status).toBe(403);
  });

  it('deletes the caller\'s own integration', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-1', 'acct-1')]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('int-1'));
    const body = (await res.json()) as { success: boolean };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(rows.length).toBe(0);
  });

  it('BUG E2 FIX: DELETE of a non-existent id → 404, not a silent 200', async () => {
    const { supabase } = fakeSupabase([]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('BUG E2 FIX / MULTI-TENANT: DELETE of another account\'s id → 404, and that integration is NOT deleted', async () => {
    const { supabase, rows } = fakeSupabase([integration('int-victim', 'acct-victim')]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('int-victim'));
    expect(res.status).toBe(404);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('int-victim');
  });
});
