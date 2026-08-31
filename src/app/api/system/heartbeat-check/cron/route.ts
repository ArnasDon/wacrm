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
import { checkInboxIntegrity } from '@/lib/observability/inbox-integrity';

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
    const neverRan = hb.lastStatus === 'never';
    const wentStale = hb.stale && !neverRan; // ran before, then stopped
    const bad = wentStale || neverRan || hb.lastStatus === 'error';
    if (bad) {
      flagged.push(hb.name);
      // critical == "was healthy, now dead" (a real outage). A job that
      // has never reported is setup-not-finished, and one bad run is a
      // blip until it repeats — both are warnings.
      const severity = wentStale ? ('critical' as const) : ('warning' as const);
      const title = wentStale
        ? `Cron "${hb.name}" stopped running`
        : neverRan
          ? `Cron "${hb.name}" has never reported`
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

  // Inbox integrity — catch a recurrence of the IG/FB dup-conversation /
  // id-less-conversation class of bug (PRs #28/#29) before a customer
  // does. Best-effort: a failure here never fails the cron.
  let inbox: Awaited<ReturnType<typeof checkInboxIntegrity>> | null = null;
  try {
    inbox = await checkInboxIntegrity();
    const dedupKey = 'inbox_integrity:zernio';
    const problem =
      !inbox.scanFailed &&
      (inbox.unrepliableConversationIds.length > 0 || inbox.duplicateThreadGroups > 0);
    if (problem) {
      await dispatchSystemAlert({
        severity: 'warning',
        source: 'inbox_integrity',
        title: 'Instagram/Facebook conversations that may not be repliable',
        detail: {
          unrepliable_conversations: inbox.unrepliableConversationIds.length,
          sample_conversation_ids: inbox.unrepliableConversationIds.slice(0, 15),
          duplicate_thread_groups: inbox.duplicateThreadGroups,
        },
        dedupKey,
        throttleMinutes: 720,
      });
    } else if (!inbox.scanFailed) {
      await resolveSystemAlert(dedupKey);
    }
  } catch (err) {
    console.error('[heartbeat-check] inbox integrity check failed:', err);
  }

  return NextResponse.json({
    checked: hbs.length,
    flagged,
    ok: recovered,
    triaged,
    inbox_integrity: inbox
      ? {
          scan_failed: inbox.scanFailed,
          unrepliable_conversations: inbox.unrepliableConversationIds.length,
          duplicate_thread_groups: inbox.duplicateThreadGroups,
        }
      : null,
  });
}
