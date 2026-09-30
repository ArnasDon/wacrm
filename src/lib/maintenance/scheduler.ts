// In-process trigger for the daily data retention (retention.ts) on
// long-running Node servers and the Kafka worker. Every process tries
// every 10 minutes; the lease in maintenance_jobs lets exactly one of
// them run it per UTC day, so any number of replicas is safe.
// Serverless hosts: point a daily cron at GET /api/maintenance/retention.

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { runDailyRetention } from './retention';

const TICK_MS = 10 * 60_000;

const g = globalThis as unknown as {
  __retentionScheduler?: ReturnType<typeof setInterval>;
};

export function startRetentionScheduler(): void {
  // Dev HMR can re-run register(); keep one interval per process.
  if (g.__retentionScheduler) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDailyRetention(supabaseAdmin());
    } catch (err) {
      // runDailyRetention never throws; belt and braces.
      console.error(
        '[retention] tick failed:',
        err instanceof Error ? err.message : err
      );
    } finally {
      running = false;
    }
  };
  g.__retentionScheduler = setInterval(tick, TICK_MS);
  g.__retentionScheduler.unref?.();
  setTimeout(tick, 60_000).unref?.();
}
