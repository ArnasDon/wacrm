import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET/PATCH/DELETE /api/automations/[id] — BUG A1 fix (Flows/
// Automations audit). These routes used to scope ownership by
// `user_id = caller`, a leftover from the pre-migration-017 model —
// contradicting the RLS policies (automations_select/update/delete:
// is_account_member(account_id[, 'agent'])) that the rest of the app
// already follows (see flows/[id]/route.ts's requireOwnership() for
// the correct, pre-existing pattern). A teammate on the SAME account
// who did not create the automation used to get 404 on every
// operation (and, for DELETE, a silent 200 that deleted nothing).
//
// This file demonstrates only the account-sharing correctness Bug A1
// requires — not a general test suite for these routes.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

/** Same generic in-memory fake pattern used across the rest of the
 *  test suite: chainable + directly awaitable (`.then`), multi-table
 *  via a Map, real column projection. Mocking `@/lib/automations/
 *  admin-client` here also covers `steps-tree.ts`'s internal
 *  supabaseAdmin() calls (GET's loadStepsTree, PATCH's replaceSteps),
 *  since both import the exact same module. */
function fakeAdmin(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables = new Map<string, Record<string, unknown>[]>();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, rows.map((r) => ({ ...r })));
  let nextId = 1;
  const table = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!;

  function builder(name: string) {
    let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
    let payload: Record<string, unknown> | Record<string, unknown>[] | undefined;
    const filters: [string, unknown][] = [];
    let single: 'one' | 'maybe' | null = null;
    let selectedCols: string[] | null = null;
    const rows = table(name);
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
      if (op === 'update') {
        const matched = rows.filter(matches);
        for (const row of matched) Object.assign(row, payload);
        const returned = matched.map(project);
        if (single === 'one') return returned[0] ? { data: returned[0], error: null } : { data: null, error: { message: 'no rows' } };
        if (single === 'maybe') return { data: returned[0] ?? null, error: null };
        return { data: returned, error: null };
      }
      if (op === 'insert') {
        const items = Array.isArray(payload) ? payload : [payload as Record<string, unknown>];
        const inserted = items.map((p) => ({ id: `${name}-${nextId++}`, created_at: 'now', ...p }));
        rows.push(...inserted);
        const returned = inserted.map(project);
        if (single === 'one' || single === 'maybe') return { data: returned[0] ?? null, error: null };
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
        if (op !== 'update' && op !== 'insert') op = 'select';
        if (cols && cols.trim() !== '*') selectedCols = cols.split(',').map((c) => c.trim());
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      order: () => api,
      update: (p: Record<string, unknown>) => {
        op = 'update';
        payload = p;
        return api;
      },
      insert: (p: Record<string, unknown> | Record<string, unknown>[]) => {
        op = 'insert';
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

  return { admin: { from: (name: string) => builder(name) } as never, table };
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => currentAdmin,
}));

// Reassigned per test via `setAdmin()` — the mock factory above closes
// over this binding so both the route file and steps-tree.ts (imported
// transitively) resolve to whatever fake the current test set up.
let currentAdmin: ReturnType<typeof fakeAdmin>['admin'];
function setAdmin(a: ReturnType<typeof fakeAdmin>) {
  currentAdmin = a.admin;
  return a;
}

import { GET, PATCH, DELETE } from './route';

function automation(id: string, accountId: string, userId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    account_id: accountId,
    user_id: userId,
    name: 'Original name',
    description: null,
    trigger_type: 'keyword_match',
    trigger_config: { keywords: ['hola'] },
    is_active: false,
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
});

describe('GET /api/automations/[id] — account-sharing (Bug A1)', () => {
  it('a teammate on the SAME account who did NOT create the automation can view it', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-B' });

    const res = await GET(new Request('http://localhost'), params('auto-1'));
    const body = (await res.json()) as { automation: { id: string; name: string } };
    expect(res.status).toBe(200);
    expect(body.automation.id).toBe('auto-1');
    expect(table('automations')[0].name).toBe('Original name'); // untouched — read-only
  });

  it('the original creator still works correctly', async () => {
    setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-A' });

    const res = await GET(new Request('http://localhost'), params('auto-1'));
    expect(res.status).toBe(200);
  });

  it('a user from ANOTHER account gets 404, never the automation', async () => {
    setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await GET(new Request('http://localhost'), params('auto-1'));
    const body = (await res.json()) as { automation?: unknown };
    expect(res.status).toBe(404);
    expect(body.automation).toBeUndefined();
  });
});

describe('PATCH /api/automations/[id] — account-sharing (Bug A1)', () => {
  it('a teammate on the SAME account who did NOT create the automation can edit it', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-B' });

    const res = await PATCH(patchRequest({ name: 'Renamed by B' }), params('auto-1'));
    expect(res.status).toBe(200);
    expect(table('automations')[0].name).toBe('Renamed by B');
  });

  it('the original creator still works correctly', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-A' });

    const res = await PATCH(patchRequest({ name: 'Renamed by A' }), params('auto-1'));
    expect(res.status).toBe(200);
    expect(table('automations')[0].name).toBe('Renamed by A');
  });

  it('a user from ANOTHER account gets 404 and the automation is left completely unmodified', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await PATCH(patchRequest({ name: 'Hacked' }), params('auto-1'));
    expect(res.status).toBe(404);
    expect(table('automations')[0].name).toBe('Original name'); // untouched
  });
});

describe('DELETE /api/automations/[id] — account-sharing (Bug A1)', () => {
  it('a teammate on the SAME account who did NOT create the automation can delete it', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-B' });

    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('auto-1'));
    const body = (await res.json()) as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(table('automations')).toHaveLength(0);
  });

  it('the original creator still works correctly', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-A' });

    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('auto-1'));
    expect(res.status).toBe(200);
    expect(table('automations')).toHaveLength(0);
  });

  it('a user from ANOTHER account gets 404 (never a false 200), and the automation is NOT deleted', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('auto-1'));
    expect(res.status).toBe(404);
    expect(table('automations')).toHaveLength(1); // still there — nothing was deleted
  });

  it('deleting a non-existent id also returns 404 (regression check for the new existence check)', async () => {
    setAdmin(fakeAdmin({ automations: [] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-A' });

    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), params('does-not-exist'));
    expect(res.status).toBe(404);
  });
});
