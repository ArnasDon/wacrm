// ============================================================
// Cron / background-job heartbeats.
//
// Every scheduled route calls `recordHeartbeat(<name>)` when it finishes
// a run. `system_heartbeats.last_run_at` then tells `/api/health` and
// the staleness checker (`/api/system/heartbeat-check/cron`) whether the
// scheduler is still firing that job — a signal a plain HTTP monitor
// hitting the app can't see on its own.
//
// Best-effort: a heartbeat write failing must never affect the job's
// real work, so every call is swallowed.
// ============================================================

import { platformAdminClient } from '@/lib/platform/admin-client';

/** Canonical heartbeat name per scheduled job + how often it is expected
 *  to run. `expectedIntervalSeconds` drives staleness: a heartbeat older
 *  than ~2x this is treated as "the scheduler stopped firing it". Tune
 *  to match the actual pg_cron / EasyPanel schedule. */
export const HEARTBEATS = {
  automations_cron: { expectedIntervalSeconds: 300 },
  flows_cron: { expectedIntervalSeconds: 300 },
  followups_cron: { expectedIntervalSeconds: 300 },
  conversations_cron: { expectedIntervalSeconds: 300 },
  webhooks_cron: { expectedIntervalSeconds: 300 },
  retention_cron: { expectedIntervalSeconds: 86_400 },
  subscriptions_cron: { expectedIntervalSeconds: 86_400 },
  // Post-sale CSAT survey sends (migration 104: */15). Watchdog
  // reads "never" until the pg_cron job is registered — expected.
  csat_cron: { expectedIntervalSeconds: 900 },
  // Lead-temperature auto-cool sweep (migration 104: hourly).
  temperature_sweep_cron: { expectedIntervalSeconds: 3_600 },
} as const;

export type HeartbeatName = keyof typeof HEARTBEATS;

export interface RecordHeartbeatOptions {
  status?: 'ok' | 'error';
  detail?: string | null;
  /** Override the registry default (seconds between expected runs). */
  intervalSeconds?: number;
}

export async function recordHeartbeat(
  name: HeartbeatName,
  opts: RecordHeartbeatOptions = {},
): Promise<void> {
  try {
    const interval =
      opts.intervalSeconds ?? HEARTBEATS[name]?.expectedIntervalSeconds ?? 300;
    const { error } = await platformAdminClient().rpc('record_heartbeat', {
      p_name: name,
      p_status: opts.status ?? 'ok',
      p_detail: opts.detail ?? null,
      p_interval_seconds: interval,
    });
    if (error) {
      console.error('[heartbeat] record failed for', name, error.message);
    }
  } catch (err) {
    console.error(
      '[heartbeat] record threw for',
      name,
      err instanceof Error ? err.message : err,
    );
  }
}

export interface HeartbeatRow {
  name: string;
  last_run_at: string;
  last_status: 'ok' | 'error';
  last_detail: string | null;
  expected_interval_seconds: number;
  runs_total: number;
}

export interface HeartbeatHealth {
  name: string;
  stale: boolean;
  lastStatus: 'ok' | 'error' | 'never';
  ageSeconds: number | null;
  expectedIntervalSeconds: number;
}

/** How much slack past `expectedIntervalSeconds` before a heartbeat is
 *  "stale" — a missed run is normal, two in a row is not. */
export const STALE_MULTIPLIER = 2.5;

/**
 * Read every expected heartbeat and classify it. A job that has NEVER
 * run shows `lastStatus: 'never'` and `stale: true` once past its first
 * expected interval — but only after the app has been up long enough
 * for a run to have happened, which the caller decides.
 */
export async function loadHeartbeatHealth(): Promise<HeartbeatHealth[]> {
  const { data, error } = await platformAdminClient()
    .from('system_heartbeats')
    .select('name, last_run_at, last_status, expected_interval_seconds, runs_total');
  if (error) {
    console.error('[heartbeat] loadHeartbeatHealth failed:', error.message);
    return [];
  }
  const byName = new Map<string, HeartbeatRow>();
  for (const row of (data ?? []) as HeartbeatRow[]) byName.set(row.name, row);

  const now = Date.now();
  return (Object.keys(HEARTBEATS) as HeartbeatName[]).map((name) => {
    const expected = HEARTBEATS[name].expectedIntervalSeconds;
    const row = byName.get(name);
    if (!row) {
      return {
        name,
        stale: true,
        lastStatus: 'never' as const,
        ageSeconds: null,
        expectedIntervalSeconds: expected,
      };
    }
    const ageSeconds = Math.round((now - new Date(row.last_run_at).getTime()) / 1000);
    return {
      name,
      stale: ageSeconds > expected * STALE_MULTIPLIER,
      lastStatus: row.last_status,
      ageSeconds,
      expectedIntervalSeconds: row.expected_interval_seconds ?? expected,
    };
  });
}
