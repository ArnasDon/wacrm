// ============================================================
// Daily data retention (migration 055).
//
// Keeps the last DATA_RETENTION_DAYS days (default 15) and deletes
// everything older, in every table except:
//   * profiles and accounts (always — every profile belongs to an
//     account, and deleting an account would cascade to its profiles),
//   * maintenance_jobs (this job's own state),
//   * tables listed in DATA_RETENTION_KEEP_TABLES (comma-separated).
// A row goes only when all its timestamps are older than the cutoff AND
// nothing still references it — so nothing newer is ever deleted or
// cascaded (see the migration).
//
//   * Once per UTC day across all instances: claim_maintenance_job()
//     leases the run in the database, so the in-process scheduler on
//     every server / worker and the cron route can all try — one wins.
//   * Batched: retention_delete_batch() deletes at most BATCH rows per
//     call, each call its own short transaction, rows picked with SKIP
//     LOCKED; a short pause between batches leaves room for app queries.
//   * FK-safe order: retention_tables() lists children before parents,
//     and the run repeats passes so a chain (reaction → message →
//     conversation → contact) clears in one day.
//   * Idempotent: an interrupted run just continues on the next one.
//   * Never throws; errors are logged and recorded in maintenance_jobs.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export const RETENTION_JOB = 'data_retention';
export const DEFAULT_RETENTION_DAYS = 15;
/** Never deleted (the SQL enforces this too). */
export const PROTECTED_TABLES = [
  'profiles',
  'accounts',
  'maintenance_jobs',
] as const;
/** Passes over all tables per run: parents free up once children go. */
const MAX_PASSES = 6;

const DAY_MS = 86_400_000;

export interface RetentionConfig {
  /** null = disabled (DATA_RETENTION_DAYS=off). */
  days: number | null;
  /** Extra tables to keep (DATA_RETENTION_KEEP_TABLES). */
  keep: string[];
  batchSize: number;
  /** Per table per run; the rest is picked up the next day. */
  maxBatchesPerTable: number;
  /** Pause between batches, so cleanup never saturates the database. */
  pauseMs: number;
  /** Whole-run time budget; the lease is longer than this. */
  budgetMs: number;
  /** Don't start before this UTC hour (quiet hours). */
  hourUtc: number;
}

function intEnv(
  raw: string | undefined,
  def: number,
  min: number,
  max: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.warn(`[retention] ${name}="${raw}" is invalid; using ${def}`);
    return def;
  }
  return n;
}

export function retentionConfig(
  env: Record<string, string | undefined> = process.env
): RetentionConfig {
  const rawDays = env.DATA_RETENTION_DAYS?.trim().toLowerCase();
  const days =
    rawDays === 'off' || rawDays === 'false'
      ? null
      : intEnv(
          env.DATA_RETENTION_DAYS,
          DEFAULT_RETENTION_DAYS,
          1,
          3650,
          'DATA_RETENTION_DAYS'
        );
  const keep = [
    ...new Set([
      ...PROTECTED_TABLES,
      ...(env.DATA_RETENTION_KEEP_TABLES ?? '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => /^[a-z_][a-z0-9_]*$/.test(t)),
    ]),
  ];
  return {
    days,
    keep,
    batchSize: intEnv(
      env.DATA_RETENTION_BATCH_SIZE,
      1000,
      1,
      10_000,
      'DATA_RETENTION_BATCH_SIZE'
    ),
    maxBatchesPerTable: 500,
    pauseMs: 100,
    // Serverless functions are cut off at 300 s.
    budgetMs: env.VERCEL ? 240_000 : 20 * 60_000,
    hourUtc: intEnv(
      env.DATA_RETENTION_HOUR_UTC,
      2,
      0,
      23,
      'DATA_RETENTION_HOUR_UTC'
    ),
  };
}

/** Rows whose timestamps are all before this instant (UTC) are deleted. */
export function retentionCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export interface TableResult {
  deleted: number;
  batches: number;
  /** More rows remain (batch cap or time budget); continues next run. */
  more: boolean;
  error?: string;
}

export interface RetentionResult {
  cutoff: string;
  days: number;
  kept: string[];
  tables: Record<string, TableResult>;
  totalDeleted: number;
  passes: number;
  ok: boolean;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * Delete everything past the retention period, table by table, in
 * batches. Doesn't take the lease — see runDailyRetention.
 */
export async function runRetention(
  db: SupabaseClient,
  opts: {
    now?: Date;
    config?: RetentionConfig;
    clock?: () => number;
  } = {}
): Promise<RetentionResult | null> {
  const config = opts.config ?? retentionConfig();
  if (config.days === null) return null;
  const clock = opts.clock ?? Date.now;
  const now = opts.now ?? new Date(clock());
  const cutoff = retentionCutoff(now, config.days);
  const deadline = clock() + config.budgetMs;

  // Children before parents, as the database sees its foreign keys.
  const { data: list, error: listErr } = await db.rpc('retention_tables', {
    p_keep: config.keep,
  });
  if (listErr) throw new Error(`listing tables: ${listErr.message}`);
  const order = ((list ?? []) as { table_name: string }[])
    .map((r) => r.table_name)
    .filter((t) => !config.keep.includes(t));

  const tables: Record<string, TableResult> = {};
  for (const t of order) tables[t] = { deleted: 0, batches: 0, more: false };
  let totalDeleted = 0;
  let passes = 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    passes++;
    let deletedThisPass = 0;
    for (const table of order) {
      const r = tables[table];
      if (r.error) continue;
      try {
        for (;;) {
          if (r.batches >= config.maxBatchesPerTable || clock() >= deadline) {
            r.more = true;
            break;
          }
          const { data, error } = await db.rpc('retention_delete_batch', {
            p_table: table,
            p_cutoff: cutoff,
            p_limit: config.batchSize,
            p_keep: config.keep,
          });
          if (error) throw new Error(error.message);
          const n = Number(data ?? 0);
          r.batches++;
          r.deleted += n;
          deletedThisPass += n;
          if (n < config.batchSize) break;
          await sleep(config.pauseMs);
        }
      } catch (err) {
        // Keep going: the SQL never deletes a row something still
        // references, so skipping one table can't break another.
        r.error = err instanceof Error ? err.message : String(err);
        console.error(`[retention] ${table}: ${r.error}`);
      }
    }
    totalDeleted += deletedThisPass;
    // Nothing freed up this pass, or out of time: done for today.
    if (deletedThisPass === 0 || clock() >= deadline) break;
  }

  for (const [table, r] of Object.entries(tables)) {
    if (r.deleted > 0 || r.more) {
      console.info(
        `[retention] ${table}: deleted ${r.deleted} row(s) older than ${cutoff}` +
          (r.more ? ' (more left, continuing next run)' : '')
      );
    }
  }
  console.info(
    `[retention] done: ${totalDeleted} row(s) deleted in ${passes} pass(es), keeping ${config.days} day(s) (cutoff ${cutoff} UTC); never deleted: ${config.keep.join(', ')}`
  );
  const ok = Object.values(tables).every((r) => !r.error);
  return {
    cutoff,
    days: config.days,
    kept: config.keep,
    tables,
    totalDeleted,
    passes,
    ok,
  };
}

export type DailyRetentionOutcome =
  | 'disabled'
  | 'not_yet' // before DATA_RETENTION_HOUR_UTC
  | 'skipped' // already ran today, or another instance is running it
  | 'done'
  | 'failed';

/**
 * Run today's cleanup if no instance has yet. Safe to call as often as
 * you like from any number of processes. Never throws.
 */
export async function runDailyRetention(
  db: SupabaseClient,
  opts: { now?: Date; config?: RetentionConfig; force?: boolean } = {}
): Promise<DailyRetentionOutcome> {
  const config = opts.config ?? retentionConfig();
  if (config.days === null) return 'disabled';
  const now = opts.now ?? new Date();
  if (!opts.force && now.getUTCHours() < config.hourUtc) return 'not_yet';

  try {
    const leaseSeconds = Math.ceil(config.budgetMs / 1000) + 600;
    const { data: claimed, error } = await db.rpc('claim_maintenance_job', {
      p_job: RETENTION_JOB,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw new Error(error.message);
    if (!claimed) return 'skipped';
  } catch (err) {
    console.error(
      '[retention] could not claim the daily run:',
      err instanceof Error ? err.message : err
    );
    return 'failed';
  }

  let result: RetentionResult | null = null;
  let failure: string | null = null;
  try {
    result = await runRetention(db, { now, config });
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    console.error('[retention] run failed:', failure);
  }
  const ok = !failure && !!result?.ok;
  try {
    await db.rpc('finish_maintenance_job', {
      p_job: RETENTION_JOB,
      p_ok: ok,
      p_result: result,
      p_error:
        failure ??
        (result && !result.ok
          ? Object.entries(result.tables)
              .filter(([, t]) => t.error)
              .map(([name, t]) => `${name}: ${t.error}`)
              .join('; ')
          : null),
    });
  } catch (err) {
    // The lease simply expires; the next run starts over (idempotent).
    console.error(
      '[retention] could not record the run:',
      err instanceof Error ? err.message : err
    );
  }
  return ok ? 'done' : 'failed';
}
