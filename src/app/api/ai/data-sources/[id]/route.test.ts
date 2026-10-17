import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// PATCH/DELETE /api/ai/data-sources/[id] — FASE 4. Never had a test
// file before. Pins the fixes for Bug #2 (a PATCH with is_primary:true
// against a missing/foreign id used to wipe every REAL source's
// is_primary flag before discovering the target didn't exist) and
// Bug #3 (that same case, and DELETE of a missing/foreign id, used to
// surface as a raw 500 instead of 404).
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

import { PATCH, DELETE } from './route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';

/** Same generic fake as ../route.test.ts. */
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

function patchRequest(id: string, body: Record<string, unknown>) {
  return PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }), params(id));
}

function ds(id: string, accountId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, account_id: accountId, source_type: 'uploaded_csv', display_name: id,
    source_url: null, source_filename: 'x.csv', usage: 'knowledge', status: 'active',
    priority: 100, is_primary: false, fallback_policy: 'fallback_on_not_found', currency: 'USD',
    column_mapping: null, row_count: 1, knowledge_document_id: null, last_synced_at: null,
    last_error: null, preview_sample: null, selected_columns: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
});

describe('PATCH /api/ai/data-sources/[id]', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await patchRequest('ds-1', { display_name: 'x' });
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await patchRequest('ds-1', { display_name: 'x' });
    expect(res.status).toBe(403);
  });

  it('invalid usage/fallback_policy/status → 400', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [ds('ds-1', 'acct-1')] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    expect((await patchRequest('ds-1', { usage: 'bogus' })).status).toBe(400);
    expect((await patchRequest('ds-1', { fallback_policy: 'bogus' })).status).toBe(400);
    expect((await patchRequest('ds-1', { status: 'bogus' })).status).toBe(400);
  });

  it('updates metadata on the caller\'s own source', async () => {
    const { supabase, tables } = fakeSupabase({ ai_data_sources: [ds('ds-1', 'acct-1', { display_name: 'Viejo nombre' })] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await patchRequest('ds-1', { display_name: 'Nuevo nombre' });
    expect(res.status).toBe(200);
    expect(tables.ai_data_sources[0].display_name).toBe('Nuevo nombre');
  });

  it('BUG #3 FIX: PATCH of a non-existent id → 404, not 500', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [ds('ds-1', 'acct-1')] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await patchRequest('does-not-exist', { display_name: 'x' });
    expect(res.status).toBe(404);
  });

  it('BUG #3 FIX: PATCH of another account\'s id → 404, not 500, and that source is untouched', async () => {
    const { supabase, tables } = fakeSupabase({ ai_data_sources: [ds('ds-victim', 'acct-victim', { display_name: 'Original' })] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await patchRequest('ds-victim', { display_name: 'Hackeado' });
    expect(res.status).toBe(404);
    expect(tables.ai_data_sources[0].display_name).toBe('Original');
    expect(tables.ai_data_sources[0].account_id).toBe('acct-victim');
  });

  it('BUG #2 FIX: PATCH is_primary:true on a NON-EXISTENT id never touches the account\'s real primary flags', async () => {
    const { supabase, tables } = fakeSupabase({
      ai_data_sources: [
        ds('ds-A', 'acct-1', { is_primary: true }),
        ds('ds-B', 'acct-1', { is_primary: false }),
      ],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await patchRequest('id-que-no-existe', { is_primary: true });
    expect(res.status).toBe(404);

    // The decisive assertion: A is STILL primary, B is STILL not — the
    // failed request must never have reached the "clear every source's
    // is_primary" step.
    const a = tables.ai_data_sources.find((r) => r.id === 'ds-A')!;
    const b = tables.ai_data_sources.find((r) => r.id === 'ds-B')!;
    expect(a.is_primary).toBe(true);
    expect(b.is_primary).toBe(false);
  });

  it('BUG #2 FIX: PATCH is_primary:true using ANOTHER account\'s id never touches the ATTACKER\'s own primary flags either', async () => {
    const { supabase, tables } = fakeSupabase({
      ai_data_sources: [
        ds('ds-victim', 'acct-victim', { is_primary: true }),
        ds('ds-attacker-A', 'acct-attacker', { is_primary: true }),
        ds('ds-attacker-B', 'acct-attacker', { is_primary: false }),
      ],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await patchRequest('ds-victim', { is_primary: true });
    expect(res.status).toBe(404);

    // Neither the victim's nor the attacker's own OTHER sources changed.
    expect(tables.ai_data_sources.find((r) => r.id === 'ds-victim')!.is_primary).toBe(true);
    expect(tables.ai_data_sources.find((r) => r.id === 'ds-attacker-A')!.is_primary).toBe(true);
    expect(tables.ai_data_sources.find((r) => r.id === 'ds-attacker-B')!.is_primary).toBe(false);
  });

  it('is_primary:true on a REAL, owned source correctly demotes the account\'s previous primary (the normal, successful case)', async () => {
    const { supabase, tables } = fakeSupabase({
      ai_data_sources: [
        ds('ds-A', 'acct-1', { is_primary: true }),
        ds('ds-B', 'acct-1', { is_primary: false }),
      ],
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await patchRequest('ds-B', { is_primary: true });
    expect(res.status).toBe(200);
    expect(tables.ai_data_sources.find((r) => r.id === 'ds-A')!.is_primary).toBe(false);
    expect(tables.ai_data_sources.find((r) => r.id === 'ds-B')!.is_primary).toBe(true);
  });

  it('a real Supabase error (not "not found") still returns 500', async () => {
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }) }) }),
    } as never;
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await patchRequest('ds-1', { display_name: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/ai/data-sources/[id]', () => {
  it('unauthenticated → 401', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const res = await DELETE(new Request('http://localhost'), params('ds-1'));
    expect(res.status).toBe(401);
  });

  it('non-admin caller → 403', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'admin' role or higher"));
    const res = await DELETE(new Request('http://localhost'), params('ds-1'));
    expect(res.status).toBe(403);
  });

  it('deletes the caller\'s own source', async () => {
    const { supabase, tables } = fakeSupabase({ ai_data_sources: [ds('ds-1', 'acct-1')] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await DELETE(new Request('http://localhost'), params('ds-1'));
    expect(res.status).toBe(200);
    expect(tables.ai_data_sources).toHaveLength(0);
  });

  it('non-existent id → 404', async () => {
    const { supabase } = fakeSupabase({ ai_data_sources: [] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await DELETE(new Request('http://localhost'), params('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('MULTI-TENANT: DELETE of another account\'s id → 404, and that source is NOT deleted', async () => {
    const { supabase, tables } = fakeSupabase({ ai_data_sources: [ds('ds-victim', 'acct-victim')] });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-attacker', userId: 'user-attacker' });

    const res = await DELETE(new Request('http://localhost'), params('ds-victim'));
    expect(res.status).toBe(404);
    expect(tables.ai_data_sources).toHaveLength(1);
    expect(tables.ai_data_sources[0].id).toBe('ds-victim');
  });
});
