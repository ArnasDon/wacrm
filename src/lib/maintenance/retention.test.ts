import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PROTECTED_TABLES,
  retentionConfig,
  retentionCutoff,
  runDailyRetention,
  runRetention,
  type RetentionConfig,
} from './retention';

vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

type Call = { fn: string; args: Record<string, unknown> };

/**
 * db.rpc double. `rows[t]` = rows past retention in table t; `children[t]`
 * = tables referencing t. Like the SQL, a table's old rows can't be
 * deleted while any child table still has rows referencing them.
 */
function fakeDb(opts: {
  rows?: Record<string, number>;
  children?: Record<string, string[]>;
  /** Order retention_tables() returns (default: keys of rows). */
  order?: string[];
  failTable?: string;
  claim?: boolean | 'error';
}) {
  const rows = { ...(opts.rows ?? {}) };
  const children = opts.children ?? {};
  const calls: Call[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'claim_maintenance_job') {
        if (opts.claim === 'error')
          return { data: null, error: { message: 'db down' } };
        return { data: opts.claim ?? true, error: null };
      }
      if (fn === 'finish_maintenance_job') return { data: null, error: null };
      if (fn === 'retention_tables') {
        const order = opts.order ?? Object.keys(rows);
        return {
          data: order.map((table_name, level) => ({ table_name, level })),
          error: null,
        };
      }
      if (fn === 'retention_delete_batch') {
        const t = args.p_table as string;
        if (t === opts.failTable)
          return { data: null, error: { message: 'lock timeout' } };
        const blocked = (children[t] ?? []).some((c) => (rows[c] ?? 0) > 0);
        const n = blocked ? 0 : Math.min(rows[t] ?? 0, args.p_limit as number);
        rows[t] = (rows[t] ?? 0) - n;
        return { data: n, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  } as unknown as SupabaseClient;
  return { db, calls, rows };
}

const cfg = (over: Partial<RetentionConfig> = {}): RetentionConfig => ({
  days: 15,
  keep: [...PROTECTED_TABLES],
  batchSize: 100,
  maxBatchesPerTable: 50,
  pauseMs: 0,
  budgetMs: 60_000,
  hourUtc: 2,
  ...over,
});
const NOW = new Date('2026-09-29T10:00:00.000Z');
const deletes = (calls: Call[]) =>
  calls.filter((c) => c.fn === 'retention_delete_batch');

describe('retentionConfig', () => {
  it('defaults to 15 days', () => {
    expect(retentionConfig({}).days).toBe(15);
    expect(retentionConfig({ DATA_RETENTION_DAYS: '' }).days).toBe(15);
  });
  it('reads DATA_RETENTION_DAYS', () => {
    expect(retentionConfig({ DATA_RETENTION_DAYS: '30' }).days).toBe(30);
  });
  it('falls back to 15 on invalid values (never 0 or negative)', () => {
    for (const v of ['0', '-3', 'abc', '1.5'])
      expect(retentionConfig({ DATA_RETENTION_DAYS: v }).days).toBe(15);
  });
  it('"off" disables it', () => {
    expect(retentionConfig({ DATA_RETENTION_DAYS: 'off' }).days).toBeNull();
  });
  it('always keeps profiles and accounts, plus DATA_RETENTION_KEEP_TABLES', () => {
    expect(retentionConfig({}).keep).toEqual(
      expect.arrayContaining(['profiles', 'accounts', 'maintenance_jobs'])
    );
    const keep = retentionConfig({
      DATA_RETENTION_KEEP_TABLES:
        'whatsapp_config, Message_Templates,bad-name;x',
    }).keep;
    expect(keep).toEqual(
      expect.arrayContaining([
        'profiles',
        'accounts',
        'whatsapp_config',
        'message_templates',
      ])
    );
    expect(keep).not.toContain('bad-name;x');
  });
  it('reads batch size and hour within bounds', () => {
    const c = retentionConfig({
      DATA_RETENTION_BATCH_SIZE: '5000',
      DATA_RETENTION_HOUR_UTC: '23',
    });
    expect(c.batchSize).toBe(5000);
    expect(c.hourUtc).toBe(23);
    expect(
      retentionConfig({ DATA_RETENTION_BATCH_SIZE: '99999' }).batchSize
    ).toBe(1000);
  });
});

describe('retentionCutoff', () => {
  it('is exactly N days before now, in UTC', () => {
    expect(retentionCutoff(NOW, 15)).toBe('2026-09-14T10:00:00.000Z');
    expect(retentionCutoff(NOW, 7)).toBe('2026-09-22T10:00:00.000Z');
  });
});

describe('runRetention', () => {
  it('deletes in batches, children first, with the same UTC cutoff', async () => {
    const { db, calls } = fakeDb({
      rows: { message_reactions: 30, messages: 250, conversations: 20 },
      children: {
        messages: ['message_reactions'],
        conversations: ['messages'],
      },
    });
    const res = await runRetention(db, { now: NOW, config: cfg() });

    // 250 at 100/batch → 100, 100, 50.
    expect(res!.tables.messages).toMatchObject({ deleted: 250, more: false });
    expect(res!.totalDeleted).toBe(300);
    expect(res!.ok).toBe(true);
    for (const c of deletes(calls)) {
      expect(c.args.p_cutoff).toBe('2026-09-14T10:00:00.000Z');
      expect(c.args.p_limit).toBe(100);
      expect(c.args.p_keep).toEqual(
        expect.arrayContaining(['profiles', 'accounts'])
      );
    }
  });

  it('clears a whole chain in one run even if tables come parent-first', async () => {
    const { db, rows } = fakeDb({
      rows: {
        contacts: 5,
        conversations: 5,
        messages: 50,
        message_reactions: 3,
      },
      children: {
        contacts: ['conversations'],
        conversations: ['messages'],
        messages: ['message_reactions'],
      },
      order: ['contacts', 'conversations', 'messages', 'message_reactions'],
    });
    const res = await runRetention(db, { now: NOW, config: cfg() });
    expect(rows).toEqual({
      contacts: 0,
      conversations: 0,
      messages: 0,
      message_reactions: 0,
    });
    expect(res!.passes).toBeGreaterThan(1);
  });

  it('never touches profiles or accounts, even if the database lists them', async () => {
    const { db, calls, rows } = fakeDb({
      rows: { profiles: 10, accounts: 2, notifications: 5 },
    });
    await runRetention(db, { now: NOW, config: cfg() });
    const touched = deletes(calls).map((c) => c.args.p_table);
    expect(touched).not.toContain('profiles');
    expect(touched).not.toContain('accounts');
    expect(rows.profiles).toBe(10);
    expect(rows.accounts).toBe(2);
    expect(rows.notifications).toBe(0);
  });

  it('keeps extra tables from DATA_RETENTION_KEEP_TABLES', async () => {
    const { db, calls } = fakeDb({
      rows: { whatsapp_config: 1, notifications: 1 },
    });
    await runRetention(db, {
      now: NOW,
      config: cfg({ keep: [...PROTECTED_TABLES, 'whatsapp_config'] }),
    });
    expect(deletes(calls).map((c) => c.args.p_table)).not.toContain(
      'whatsapp_config'
    );
  });

  it('stops at the per-table batch cap and says more is left', async () => {
    const { db, rows } = fakeDb({ rows: { messages: 10_000 } });
    const res = await runRetention(db, {
      now: NOW,
      config: cfg({ maxBatchesPerTable: 3 }),
    });
    expect(res!.tables.messages).toMatchObject({ deleted: 300, more: true });
    expect(rows.messages).toBe(9_700);
  });

  it('stops when the time budget runs out', async () => {
    let t = 0;
    const { db } = fakeDb({ rows: { messages: 10_000 } });
    const res = await runRetention(db, {
      now: NOW,
      config: cfg({ budgetMs: 5 }),
      clock: () => (t += 1),
    });
    expect(res!.tables.messages.more).toBe(true);
    expect(res!.tables.messages.deleted).toBeLessThan(10_000);
  });

  it('an error on one table is recorded and the others still run', async () => {
    const { db } = fakeDb({
      rows: { flow_run_events: 10, notifications: 5 },
      failTable: 'flow_run_events',
    });
    const res = await runRetention(db, { now: NOW, config: cfg() });
    expect(res!.tables.flow_run_events.error).toBe('lock timeout');
    expect(res!.tables.notifications.deleted).toBe(5);
    expect(res!.ok).toBe(false);
  });

  it('does nothing when disabled', async () => {
    const { db, calls } = fakeDb({ rows: { notifications: 5 } });
    expect(await runRetention(db, { config: cfg({ days: null }) })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('is idempotent: a second run finds nothing left', async () => {
    const { db } = fakeDb({ rows: { ai_usage_log: 120 } });
    await runRetention(db, { now: NOW, config: cfg() });
    const again = await runRetention(db, { now: NOW, config: cfg() });
    expect(again!.totalDeleted).toBe(0);
  });
});

describe('runDailyRetention', () => {
  it('waits for the configured UTC hour', async () => {
    const { db, calls } = fakeDb({});
    const early = new Date('2026-09-29T01:59:00Z');
    expect(await runDailyRetention(db, { now: early, config: cfg() })).toBe(
      'not_yet'
    );
    expect(calls).toHaveLength(0);
  });

  it('skips when another instance already has today', async () => {
    const { db, calls } = fakeDb({ claim: false, rows: { notifications: 5 } });
    expect(await runDailyRetention(db, { now: NOW, config: cfg() })).toBe(
      'skipped'
    );
    expect(calls.map((c) => c.fn)).toEqual(['claim_maintenance_job']);
  });

  it('claims, runs, and records the result', async () => {
    const { db, calls } = fakeDb({ rows: { notifications: 5 } });
    expect(await runDailyRetention(db, { now: NOW, config: cfg() })).toBe(
      'done'
    );
    const finish = calls.find((c) => c.fn === 'finish_maintenance_job')!;
    expect(finish.args.p_ok).toBe(true);
    expect(
      (finish.args.p_result as { totalDeleted: number }).totalDeleted
    ).toBe(5);
    expect(calls[0].fn).toBe('claim_maintenance_job');
  });

  it('records a failed table so the run is retried later', async () => {
    const { db, calls } = fakeDb({
      rows: { notifications: 1 },
      failTable: 'notifications',
    });
    expect(await runDailyRetention(db, { now: NOW, config: cfg() })).toBe(
      'failed'
    );
    const finish = calls.find((c) => c.fn === 'finish_maintenance_job')!;
    expect(finish.args.p_ok).toBe(false);
    expect(finish.args.p_error).toContain('notifications: lock timeout');
  });

  it('never throws when the database is unreachable', async () => {
    const { db } = fakeDb({ claim: 'error' });
    await expect(
      runDailyRetention(db, { now: NOW, config: cfg() })
    ).resolves.toBe('failed');
  });

  it('reports disabled without touching the database', async () => {
    const { db, calls } = fakeDb({});
    expect(await runDailyRetention(db, { config: cfg({ days: null }) })).toBe(
      'disabled'
    );
    expect(calls).toHaveLength(0);
  });
});

describe('migration 055', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/055_data_retention.sql'),
    'utf8'
  );
  const fn = sql.slice(
    sql.indexOf('FUNCTION public.retention_delete_batch'),
    sql.indexOf('-- ---- Indexes')
  );

  it('always protects profiles and accounts', () => {
    expect(sql).toMatch(/ARRAY\['profiles', 'accounts', 'maintenance_jobs'\]/);
    expect(fn).toMatch(/retention_tables\(p_keep\)/); // whitelist check
  });

  it('deletes only rows that are old on every timestamp and unreferenced', () => {
    expect(fn).toMatch(/IS NULL OR t\.%1\$I < \$1/); // every timestamp column
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM %s c WHERE %s\)/); // every FK
    expect(fn).toMatch(/confrelid = v_rel/);
  });

  it('deletes in bounded batches without waiting on locks', () => {
    expect(fn).toMatch(/LIMIT %5\$s/);
    expect(fn).toMatch(/FOR UPDATE OF t SKIP LOCKED/);
    expect(fn).toMatch(/lock_timeout = '5s'/);
  });

  it('refuses a cutoff less than a day old', () => {
    expect(fn).toMatch(/p_cutoff > now\(\) - INTERVAL '1 day'/);
  });

  it('builds SQL only from quoted identifiers', () => {
    expect(fn).not.toMatch(/\|\| p_table/);
    expect(fn).toMatch(/format\('public\.%I', p_table\)::REGCLASS/);
  });

  it('is callable by the server only', () => {
    for (const f of [
      'retention_delete_batch',
      'retention_tables',
      'claim_maintenance_job',
    ])
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${f}[\\s\\S]*?FROM PUBLIC, anon, authenticated`
        )
      );
  });
});
