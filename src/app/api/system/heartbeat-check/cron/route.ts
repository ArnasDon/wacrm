// ============================================================
// GET /api/system/heartbeat-check/cron
//
// Runs every few minutes (external scheduler, `x-cron-secret` header).
// Reads `system_heartbeats`, and for every job that is stale (no run in
// ~2.5x its expected interval) or last errored, opens/refreshes a
// `system_alert` (deduped + throttled). When a job recovers, the alert
// is resolved so a later recurrence notifies again.
//
// This is the layer the plain HTTP monitor can't provide: a dead cron
// doesn't call anything, so nothing else would notice it stopped.
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { NextResponse, after } from 'next/server';
import { loadHeartbeatHealth } from '@/lib/observability/heartbeat';
import { dispatchSystemAlert, resolveSystemAlert } from '@/lib/observability/alerts';
import { runAlertTriage, isTriageConfigured } from '@/lib/observability/triage';

function authorized(request: Request): boolean {
  const expected =
    process.env.HEALTHCHECK_CRON_SECRET ?? process.env.WEBHOOK_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.HEALTHCHECK_CRON_SECRET && !process.env.WEBHOOK_CRON_SECRET) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hbs = await loadHeartbeatHealth();
  const flagged: string[] = [];
  const recovered: string[] = [];
  let triaged = 0;

  for (const hb of hbs) {
    const dedupKey = `cron_heartbeat:${hb.name}`;
    const bad = hb.stale || hb.lastStatus === 'error';
    if (bad) {
      flagged.push(hb.name);
      const severity = hb.stale ? ('critical' as const) : ('warning' as const);
      const title = hb.stale
        ? `Cron "${hb.name}" has not run`
        : `Cron "${hb.name}" last run errored`;
      const detail = {
        job: hb.name,
        lastStatus: hb.lastStatus,
        ageSeconds: hb.ageSeconds,
        expectedIntervalSeconds: hb.expectedIntervalSeconds,
      };
      const res = await dispatchSystemAlert({
        severity,
        source: 'cron_heartbeat',
        title,
        detail,
        dedupKey,
        throttleMinutes: 60,
      });
      // Only diagnose a genuinely NEW alert — a still-open one already
      // got its triage note, and re-running the model every 5 min would
      // just burn the ops key.
      if (res.opened && isTriageConfigured()) {
        triaged += 1;
        after(() =>
          runAlertTriage({ severity, source: 'cron_heartbeat', title, detail, dedupKey, alertId: res.alertId }),
        );
      }
    } else {
      recovered.push(hb.name);
      await resolveSystemAlert(dedupKey);
    }
  }

  // The checker's own liveness needs no heartbeat row: if it stops, the
  // external monitor's `/api/health?full=1` call still surfaces stale
  // jobs directly.

  return NextResponse.json({
    checked: hbs.length,
    flagged,
    ok: recovered,
    triaged,
  });
}
