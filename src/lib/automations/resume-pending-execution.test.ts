import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// BUG A2 fix (Flows/Automations audit) — resumePendingExecution() used
// to leave the `automations` lookup OUTSIDE its own try/catch. The
// cron's claim step already flips a due row's status to 'running'
// BEFORE calling resumePendingExecution; if that lookup call itself
// THREW (a genuine network-level failure — a real, documented
// difference in supabase-js between "the request completed with a
// Postgres error" and "the request itself never completed") rather
// than merely returning `{error}`, the exception escaped before
// markPending() ever ran. Since the cron's own SELECT only ever looks
// for status='pending', a row stuck at 'running' was never picked up,
// retried, or reported again — permanently lost.
//
// This file tests two things at two different levels:
//   1. resumePendingExecution() itself (unit-level, mocking only
//      @/lib/automations/admin-client) — the exact throw scenario, the
//      pre-existing "normal Supabase error" path (regression), and the
//      successful path (regression).
//   2. The cron route's batch loop (HTTP-level) — proving a single
//      row's unexpected failure never aborts the rest of the batch.
// ============================================================

/** Generic in-memory fake for the tables resumePendingExecution/
 *  executeStepsFrom/the cron route touch. Chainable + directly
 *  awaitable (`.then`), real column projection, multi-table via a Map
 *  — same pattern used throughout this test suite. Adds `.lte()`/`.is()`
 *  support (needed by the cron's due-row query and executeStepsFrom's
 *  root-scope query respectively) and a hook to make a specific
 *  `automations` lookup THROW instead of resolving.
 */
function fakeAdmin(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables = new Map<string, Record<string, unknown>[]>();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, rows.map((r) => ({ ...r })));
  const table = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!;

  // When set, a SELECT on `automations` filtered to this exact id
  // throws synchronously instead of resolving — simulating a genuine
  // network-level failure (fetch rejecting), not a returned Supabase
  // `{error}`.
  let throwOnAutomationSelect: string | null = null;
  function setThrowOnAutomationSelect(automationId: string) {
    throwOnAutomationSelect = automationId;
  }

  function builder(name: string) {
    let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
    let payload: Record<string, unknown> | Record<string, unknown>[] | undefined;
    const filters: [string, unknown][] = [];
    const nullFilters: string[] = [];
    const compareFilters: [string, 'lte' | 'gte', unknown][] = [];
    let single: 'one' | 'maybe' | null = null;
    let selectedCols: string[] | null = null;
    const rows = table(name);
    // Numeric comparison when both sides are numbers (e.g. `position`);
    // otherwise lexicographic (correct for ISO-8601 `run_at` strings).
    const cmp = (a: unknown, b: unknown): number =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    const matches = (row: Record<string, unknown>) =>
      filters.every(([c, v]) => row[c] === v) &&
      nullFilters.every((c) => row[c] == null) &&
      compareFilters.every(([c, kind, v]) => (kind === 'lte' ? cmp(row[c], v) <= 0 : cmp(row[c], v) >= 0));

    function project<T extends Record<string, unknown>>(row: T): T {
      if (!selectedCols) return row;
      const out = {} as Record<string, unknown>;
      for (const col of selectedCols) out[col] = row[col];
      return out as T;
    }

    function execute(): { data: unknown; error: unknown } {
      if (
        name === 'automations' &&
        op === 'select' &&
        throwOnAutomationSelect &&
        filters.some(([c, v]) => c === 'id' && v === throwOnAutomationSelect)
      ) {
        throw new Error('simulated network failure: fetch failed');
      }
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
        const inserted = items.map((p) => ({ id: `${name}-${Math.random().toString(36).slice(2)}`, ...p }));
        rows.push(...inserted);
        const returned = inserted.map(project);
        if (single === 'one' || single === 'maybe') return { data: returned[0] ?? null, error: null };
        return { data: returned, error: null };
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
      lte: (col: string, val: unknown) => {
        // Used on `run_at` (ISO strings) by the cron's due-row query. A
        // filter, not a mutation — must not alter the underlying table.
        compareFilters.push([col, 'lte', val]);
        return api;
      },
      gte: (col: string, val: unknown) => {
        // Used on `position` (a number) by executeStepsFrom.
        compareFilters.push([col, 'gte', val]);
        return api;
      },
      is: (col: string, val: null) => {
        if (val === null) nullFilters.push(col);
        return api;
      },
      order: () => api,
      limit: () => api,
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
      single: () => {
        single = 'one';
        return Promise.resolve(execute());
      },
      maybeSingle: () => {
        single = 'maybe';
        return Promise.resolve(execute());
      },
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve().then(() => execute()).then(resolve, reject),
    };
    return api;
  }

  return {
    admin: { from: (name: string) => builder(name), rpc: () => Promise.resolve({ error: null }) } as never,
    table,
    setThrowOnAutomationSelect,
  };
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => currentAdmin,
}));
vi.mock('@/lib/automations/meta-send', () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
}));

let currentAdmin: ReturnType<typeof fakeAdmin>['admin'];
function setAdmin(a: ReturnType<typeof fakeAdmin>) {
  currentAdmin = a.admin;
  return a;
}

import { resumePendingExecution } from './engine';
import { GET as cronGET } from '@/app/api/automations/cron/route';

function automation(id: string, accountId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    account_id: accountId,
    user_id: 'user-1',
    name: 'Test automation',
    trigger_type: 'keyword_match',
    trigger_config: {},
    is_active: true,
    ...overrides,
  };
}

function pendingRow(id: string, automationId: string, accountId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    automation_id: automationId,
    account_id: accountId,
    user_id: 'user-1',
    contact_id: null,
    log_id: null,
    parent_step_id: null,
    branch: null,
    next_step_position: 0,
    context: {},
    run_at: '2020-01-01T00:00:00Z',
    status: 'pending',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'test-secret');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resumePendingExecution — BUG A2 fix', () => {
  it('an exception thrown by the automations lookup (not a returned {error}) still ends the row in status=\'failed\', never stuck at \'running\'', async () => {
    const fake = setAdmin(
      fakeAdmin({
        automation_pending_executions: [pendingRow('pend-1', 'auto-1', 'acct-1', { status: 'running' })],
      }),
    );
    fake.setThrowOnAutomationSelect('auto-1');

    // Must not throw out of resumePendingExecution itself — the cron
    // route awaits this directly.
    await expect(
      resumePendingExecution({
        id: 'pend-1',
        automation_id: 'auto-1',
        user_id: 'user-1',
        account_id: 'acct-1',
        contact_id: null,
        log_id: null,
        parent_step_id: null,
        branch: null,
        next_step_position: 0,
        context: {},
      }),
    ).resolves.toBeUndefined();

    expect(fake.table('automation_pending_executions')[0].status).toBe('failed');
  });

  it('a normal Supabase error (returned {error}, not a throw) still ends the row in status=\'failed\' (pre-existing behavior, unchanged)', async () => {
    // No automation row seeded at all → the lookup resolves with
    // data:null, matching "missing automation" — the already-existing
    // error path.
    const { table } = setAdmin(
      fakeAdmin({
        automation_pending_executions: [pendingRow('pend-1', 'auto-missing', 'acct-1', { status: 'running' })],
      }),
    );

    await resumePendingExecution({
      id: 'pend-1',
      automation_id: 'auto-missing',
      user_id: 'user-1',
      account_id: 'acct-1',
      contact_id: null,
      log_id: null,
      parent_step_id: null,
      branch: null,
      next_step_position: 0,
      context: {},
    });

    expect(table('automation_pending_executions')[0].status).toBe('failed');
  });

  it('the successful path still ends the row in status=\'done\' (regression check)', async () => {
    const { table } = setAdmin(
      fakeAdmin({
        automations: [automation('auto-1', 'acct-1')],
        automation_pending_executions: [pendingRow('pend-1', 'auto-1', 'acct-1', { status: 'running', log_id: 'log-1' })],
        automation_logs: [{ id: 'log-1', steps_executed: [], status: 'partial' }],
        automation_steps: [], // no steps left to run from this position → clean success
      }),
    );

    await resumePendingExecution({
      id: 'pend-1',
      automation_id: 'auto-1',
      user_id: 'user-1',
      account_id: 'acct-1',
      contact_id: null,
      log_id: 'log-1',
      parent_step_id: null,
      branch: null,
      next_step_position: 0,
      context: {},
    });

    expect(table('automation_pending_executions')[0].status).toBe('done');
    // The established automation_log error path is untouched: a clean
    // resume with no remaining steps finalizes the log as success.
    expect(table('automation_logs')[0].status).toBe('success');
  });
});

describe('GET /api/automations/cron — BUG A2 fix: one failing row never aborts the rest of the batch', () => {
  it('a row whose resume throws is marked failed, and the OTHER due row in the same batch is still processed', async () => {
    const fake = setAdmin(
      fakeAdmin({
        automations: [automation('auto-ok', 'acct-1')],
        automation_pending_executions: [
          pendingRow('pend-throws', 'auto-throws', 'acct-1'),
          pendingRow('pend-ok', 'auto-ok', 'acct-1', { log_id: 'log-1' }),
        ],
        automation_logs: [{ id: 'log-1', steps_executed: [], status: 'partial' }],
        automation_steps: [],
      }),
    );
    fake.setThrowOnAutomationSelect('auto-throws');

    const res = await cronGET(
      new Request('http://localhost/api/automations/cron', { headers: { 'x-cron-secret': 'test-secret' } }),
    );
    const body = (await res.json()) as { processed: number };

    expect(res.status).toBe(200);
    // Both rows were attempted — the failing one didn't stop the loop.
    expect(body.processed).toBe(2);
    expect(fake.table('automation_pending_executions').find((r) => r.id === 'pend-throws')!.status).toBe('failed');
    expect(fake.table('automation_pending_executions').find((r) => r.id === 'pend-ok')!.status).toBe('done');
  });
});
