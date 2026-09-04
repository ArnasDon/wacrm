import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/automations/[id]/duplicate — BUG A1 fix (Flows/
// Automations audit). Same root cause as [id]/route.test.ts: this
// route used to scope ownership by `user_id = caller` instead of the
// account-wide model the RLS policies (migration 017) already use —
// a teammate on the SAME account who did not create the automation
// used to get 404 when trying to duplicate it.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

/** Same generic in-memory fake as ../route.test.ts. */
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

let currentAdmin: ReturnType<typeof fakeAdmin>['admin'];
function setAdmin(a: ReturnType<typeof fakeAdmin>) {
  currentAdmin = a.admin;
  return a;
}

import { POST } from './route';

function automation(id: string, accountId: string, userId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    account_id: accountId,
    user_id: userId,
    name: 'Original',
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

beforeEach(() => {
  mocks.requireRole.mockReset();
});

describe('POST /api/automations/[id]/duplicate — account-sharing (Bug A1)', () => {
  it('a teammate on the SAME account who did NOT create the automation can duplicate it', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-B' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('auto-1'));
    const body = (await res.json()) as { automation: { name: string; account_id: string; user_id: string } };
    expect(res.status).toBe(201);
    expect(body.automation.name).toBe('Original (Copy)');
    expect(body.automation.account_id).toBe('acct-1'); // cloned into the SAME account
    expect(body.automation.user_id).toBe('user-B'); // the duplicator becomes the copy's author
    expect(table('automations')).toHaveLength(2); // original + copy, original untouched
    expect(table('automations').find((r) => r.id === 'auto-1')!.name).toBe('Original');
  });

  it('the original creator still works correctly', async () => {
    setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-A' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('auto-1'));
    const body = (await res.json()) as { automation: { user_id: string } };
    expect(res.status).toBe(201);
    expect(body.automation.user_id).toBe('user-A');
  });

  it('a user from ANOTHER account gets 404, and no copy is created', async () => {
    const { table } = setAdmin(fakeAdmin({ automations: [automation('auto-1', 'acct-1', 'user-A')] }));
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('auto-1'));
    expect(res.status).toBe(404);
    expect(table('automations')).toHaveLength(1); // no copy was inserted
  });

  it('duplicating steps: only the same-account teammate case copies the original\'s steps under the new automation', async () => {
    const { table } = setAdmin(
      fakeAdmin({
        automations: [automation('auto-1', 'acct-1', 'user-A')],
        automation_steps: [
          { id: 'step-1', automation_id: 'auto-1', parent_step_id: null, branch: null, step_type: 'add_tag', step_config: { tag_id: 't1' }, position: 0 },
        ],
      }),
    );
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-B' });

    const res = await POST(new Request('http://localhost', { method: 'POST' }), params('auto-1'));
    const body = (await res.json()) as { automation: { id: string } };
    expect(res.status).toBe(201);
    const copiedSteps = table('automation_steps').filter((s) => s.automation_id === body.automation.id);
    expect(copiedSteps).toHaveLength(1);
    expect(copiedSteps[0].step_type).toBe('add_tag');
  });
});
