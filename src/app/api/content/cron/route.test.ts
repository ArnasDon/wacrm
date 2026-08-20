import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Regression coverage for "GET /api/content/cron returns {sent:0} for a
// due content post". Unlike most fakes in this test suite (a hand-rolled
// builder that just returns a canned response per table), the
// `broadcasts` fake here actually EVALUATES the accumulated .eq()/.not()/
// .lte()/.or() predicates against an in-memory row, the same way
// PostgREST would — because the bug report was specifically "the scan
// query doesn't match a row that should match it", and a fake that just
// echoes back whatever the test hands it can't catch a real predicate
// bug (it would happily "match" regardless of what the route asked for).
// claimBroadcastDelivery / releaseBroadcastDelivery (broadcast-resume.ts)
// are NOT mocked, for the same reason — their conditional UPDATE is part
// of "does a due post actually get drained" and already runs against
// this same fake row. deliverContentBroadcast IS mocked: its own
// behaviour is covered by src/lib/content/deliver.test.ts, and mocking it
// here isolates this test to the cron route's scan/claim/loop logic,
// which is what the bug report is actually about.

const mocks = vi.hoisted(() => ({
  deliverContentBroadcast: vi.fn<(...args: unknown[]) => Promise<void>>(
    async () => {}
  ),
}));

vi.mock('@/lib/content/deliver', () => ({
  deliverContentBroadcast: mocks.deliverContentBroadcast,
}));

interface BroadcastRow {
  id: string;
  account_id: string;
  content_id: string | null;
  language: string | null;
  status: string;
  scheduled_at: string;
  delivery_locked_at: string | null;
}

/**
 * A `broadcasts` table fake that actually evaluates the predicate
 * chain, not a canned-response stub. Covers exactly the three query
 * shapes this route (directly, or via broadcast-resume.ts) issues:
 *   1. select().not('content_id','is',null).eq('status',x).lte('scheduled_at',x)  — the due-post scan
 *   2. update({delivery_locked_at}).eq('id',x).eq('account_id',x).or('...').select('id')  — claim
 *   3. update({delivery_locked_at:null}).eq('id',x)  — release
 */
function fakeAdmin(rows: BroadcastRow[]) {
  function broadcastsTable() {
    const eqFilters: [string, unknown][] = [];
    let notNullCol: string | null = null;
    let lteFilter: [string, string] | null = null;
    let orExpr: string | null = null;
    let updateValues: Partial<BroadcastRow> | null = null;

    function matches(row: BroadcastRow): boolean {
      for (const [col, val] of eqFilters) {
        if ((row as unknown as Record<string, unknown>)[col] !== val)
          return false;
      }
      if (
        notNullCol &&
        (row as unknown as Record<string, unknown>)[notNullCol] === null
      ) {
        return false;
      }
      if (lteFilter) {
        const [col, val] = lteFilter;
        const rowVal = (row as unknown as Record<string, unknown>)[col] as
          string | null;
        if (!rowVal || new Date(rowVal) > new Date(val)) return false;
      }
      if (orExpr) {
        // Only form ever used in this codebase:
        // "delivery_locked_at.is.null,delivery_locked_at.lt.<iso>"
        const clauses = orExpr.split(',');
        const ok = clauses.some((clause) => {
          const [col, op, val] = clause.split('.');
          const rowVal = (row as unknown as Record<string, unknown>)[col] as
            string | null;
          if (op === 'is' && val === 'null') return rowVal === null;
          if (op === 'lt') return !!rowVal && new Date(rowVal) < new Date(val);
          return false;
        });
        if (!ok) return false;
      }
      return true;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: () => builder,
      not: (col: string, op: string, val: unknown) => {
        if (op === 'is' && val === null) notNullCol = col;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        eqFilters.push([col, val]);
        return builder;
      },
      lte: (col: string, val: string) => {
        lteFilter = [col, val];
        return builder;
      },
      or: (expr: string) => {
        orExpr = expr;
        return builder;
      },
      update: (values: Partial<BroadcastRow>) => {
        updateValues = values;
        return builder;
      },
      then: (resolve: (r: { data: unknown; error: null }) => unknown) => {
        const matched = rows.filter(matches);
        if (updateValues) {
          for (const row of matched) Object.assign(row, updateValues);
        }
        return resolve({ data: matched, error: null });
      },
    };
    return builder;
  }

  return {
    rows,
    from: (table: string) => {
      if (table === 'broadcasts') return broadcastsTable();
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => currentAdmin,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentAdmin: any;

const { GET } = await import('./route');

function request() {
  return new Request('http://localhost/api/content/cron', {
    headers: { 'x-cron-secret': 'test-secret' },
  });
}

// Computed relative to the actual clock at test-run time, not a fixed
// literal — the route compares against `new Date()` for real, so a
// hardcoded "past" timestamp would silently become a future one (and
// flip this test's meaning) whenever it's run on a later date.
const DUE_AT = () => new Date(Date.now() - 5 * 60 * 1000).toISOString();
const NOT_YET_DUE_AT = () =>
  new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

const ORIGINAL_SECRET = process.env.AUTOMATION_CRON_SECRET;

beforeEach(() => {
  process.env.AUTOMATION_CRON_SECRET = 'test-secret';
  mocks.deliverContentBroadcast.mockClear();
});

afterEach(() => {
  process.env.AUTOMATION_CRON_SECRET = ORIGINAL_SECRET;
});

describe('GET /api/content/cron', () => {
  it('drains a due content post: matches it, claims it, delivers it, and reports sent:1', async () => {
    const row: BroadcastRow = {
      id: 'bc-1',
      account_id: 'acct-1',
      content_id: 'content-1',
      language: null,
      status: 'scheduled',
      scheduled_at: DUE_AT(),
      delivery_locked_at: null,
    };
    currentAdmin = fakeAdmin([row]);

    const res = await GET(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ sent: 1 });
    expect(mocks.deliverContentBroadcast).toHaveBeenCalledTimes(1);
    expect(mocks.deliverContentBroadcast).toHaveBeenCalledWith(
      currentAdmin,
      expect.objectContaining({ id: 'bc-1', content_id: 'content-1' })
    );
    // Claimed then released — not left locked for the next tick.
    expect(row.delivery_locked_at).toBeNull();
  });

  it('does not drain a broadcast with no content_id (a template broadcast, not a Content Studio post)', async () => {
    currentAdmin = fakeAdmin([
      {
        id: 'bc-2',
        account_id: 'acct-1',
        content_id: null,
        language: null,
        status: 'scheduled',
        scheduled_at: DUE_AT(),
        delivery_locked_at: null,
      },
    ]);

    const res = await GET(request());
    expect(await res.json()).toEqual({ sent: 0 });
    expect(mocks.deliverContentBroadcast).not.toHaveBeenCalled();
  });

  it('does not drain a broadcast that is not yet due, and logs the 0-matched scan (the diagnostic the live "sent:0" report was missing)', async () => {
    currentAdmin = fakeAdmin([
      {
        id: 'bc-3',
        account_id: 'acct-1',
        content_id: 'content-1',
        language: null,
        status: 'scheduled',
        scheduled_at: NOT_YET_DUE_AT(),
        delivery_locked_at: null,
      },
    ]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await GET(request());
    expect(await res.json()).toEqual({ sent: 0 });
    expect(mocks.deliverContentBroadcast).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('scan: 0 due broadcast(s)')
    );
    logSpy.mockRestore();
  });

  it('does not drain a broadcast whose status is not "scheduled" (already sending/sent/failed/draft)', async () => {
    for (const status of ['sending', 'sent', 'failed', 'draft']) {
      currentAdmin = fakeAdmin([
        {
          id: 'bc-4',
          account_id: 'acct-1',
          content_id: 'content-1',
          language: null,
          status,
          scheduled_at: DUE_AT(),
          delivery_locked_at: null,
        },
      ]);
      const res = await GET(request());
      expect(await res.json()).toEqual({ sent: 0 });
    }
    expect(mocks.deliverContentBroadcast).not.toHaveBeenCalled();
  });

  it('does not double-send a post another concurrent run already holds the lock on, and logs which broadcast was skipped and why', async () => {
    currentAdmin = fakeAdmin([
      {
        id: 'bc-5',
        account_id: 'acct-1',
        content_id: 'content-1',
        language: null,
        status: 'scheduled',
        scheduled_at: DUE_AT(),
        // Locked a few seconds ago by another in-flight run — well
        // inside the staleness window, so this run must not claim it.
        delivery_locked_at: new Date().toISOString(),
      },
    ]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await GET(request());
    expect(await res.json()).toEqual({ sent: 0 });
    expect(mocks.deliverContentBroadcast).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('scan: 1 due broadcast(s)')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipped broadcast bc-5')
    );
    logSpy.mockRestore();
  });

  it('releases the lock (does not leave it stuck) even when delivery throws', async () => {
    mocks.deliverContentBroadcast.mockRejectedValueOnce(new Error('boom'));
    const row: BroadcastRow = {
      id: 'bc-6',
      account_id: 'acct-1',
      content_id: 'content-1',
      language: null,
      status: 'scheduled',
      scheduled_at: DUE_AT(),
      delivery_locked_at: null,
    };
    currentAdmin = fakeAdmin([row]);

    const res = await GET(request());
    expect(await res.json()).toEqual({ sent: 0 });
    expect(row.delivery_locked_at).toBeNull();
  });

  it('401s on a wrong or missing cron secret, before touching the database', async () => {
    currentAdmin = fakeAdmin([]);
    const res = await GET(
      new Request('http://localhost/api/content/cron', {
        headers: { 'x-cron-secret': 'wrong' },
      })
    );
    expect(res.status).toBe(401);
  });
});
