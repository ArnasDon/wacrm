// ============================================================
// POST /api/system/triage   { dedupKey: string }
//
// Manually ask the triage bot to (re-)diagnose one open alert and post
// its notes to Telegram. Platform-admin only. The heartbeat-check cron
// triages new alerts automatically; this is the "look at this one
// again" button for a human working an incident.
// ============================================================

import { NextResponse } from 'next/server';
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import { platformAdminClient } from '@/lib/platform/admin-client';
import { runAlertTriage, isTriageConfigured } from '@/lib/observability/triage';

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();

    if (!isTriageConfigured()) {
      return NextResponse.json(
        { error: 'Triage not configured (set OPS_AI_API_KEY).' },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => null)) as { dedupKey?: unknown } | null;
    const dedupKey = typeof body?.dedupKey === 'string' ? body.dedupKey.trim() : '';
    if (!dedupKey) {
      return NextResponse.json({ error: 'dedupKey is required' }, { status: 400 });
    }

    const { data: alert, error } = await platformAdminClient()
      .from('system_alerts')
      .select('id, severity, source, title, detail, dedup_key')
      .eq('dedup_key', dedupKey)
      .is('resolved_at', null)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!alert) {
      return NextResponse.json({ error: 'No open alert for that dedupKey' }, { status: 404 });
    }

    const diagnosis = await runAlertTriage({
      severity: alert.severity,
      source: alert.source,
      title: alert.title,
      detail: (alert.detail ?? {}) as Record<string, unknown>,
      dedupKey: alert.dedup_key,
      alertId: alert.id,
    });

    if (!diagnosis) {
      return NextResponse.json(
        { error: 'Triage produced no output — check server logs.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ alertId: alert.id, diagnosis });
  } catch (err) {
    return toErrorResponse(err);
  }
}
