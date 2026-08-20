import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  claimBroadcastDelivery,
  releaseBroadcastDelivery,
} from '@/lib/whatsapp/broadcast-resume';
import { deliverContentBroadcast } from '@/lib/content/deliver';

/**
 * Drain due Content Studio scheduled posts.
 *
 * Every `broadcasts` row with `content_id IS NOT NULL`,
 * `status = 'scheduled'`, and `scheduled_at <= now()` gets sent —
 * this is the ONLY place a scheduled content post actually goes out
 * (see the schedule route's comment: there is no separate
 * "send immediately" code path).
 *
 * Auth: reuses `AUTOMATION_CRON_SECRET`, same header
 * (`x-cron-secret`) and constant-time compare as `GET /api/flows/cron`
 * — one secret, one pattern, per §10's explicit instruction not to
 * invent a new one.
 *
 * Idempotent: each due broadcast is claimed via the same
 * `delivery_locked_at` mutex migration 038 introduced
 * (`claimBroadcastDelivery`) before anything sends, so two overlapping
 * cron runs (or a slow run overlapping the next tick) can't send the
 * same post twice. A broadcast whose claim fails is simply left for
 * the next tick — no error, no partial state.
 *
 * Hosting: same as the Flows/automations crons — hit on a schedule
 * (Vercel Cron / GitHub Actions / external pinger). A short interval
 * (1-5 minutes) keeps "scheduled for now" close to actually immediate.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const now = new Date();

  const { data: due, error } = await admin
    .from('broadcasts')
    .select('id, account_id, content_id, language')
    .not('content_id', 'is', null)
    .eq('status', 'scheduled')
    .lte('scheduled_at', now.toISOString());

  if (error) {
    console.error('[content-cron] due-broadcast scan failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log the scan result unconditionally — this is the one line that
  // tells the two "matched but silently did nothing" failure modes
  // below apart from "nothing was actually due": a broadcast that
  // looks due by every field a human can eyeball (status/content_id/
  // scheduled_at) but doesn't get sent is either never reaching this
  // scan at all (a data issue on the row itself — e.g. content_id
  // actually NULL, or scheduled_at not what it appears once cast to
  // timestamptz) or reaching it and then failing to claim (below).
  // Before this, both looked identical from the outside: `{sent: 0}`
  // with nothing in the log to tell them apart.
  console.log(
    `[content-cron] scan: ${due?.length ?? 0} due broadcast(s) at ${now.toISOString()}`
  );
  if (!due?.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  for (const broadcast of due as {
    id: string;
    account_id: string;
    content_id: string;
    language: string | null;
  }[]) {
    const claimed = await claimBroadcastDelivery(
      admin,
      broadcast.account_id,
      broadcast.id,
      now
    );
    if (!claimed) {
      // Either a concurrent run holds a fresh (non-stale) lock, or a
      // previous run crashed hard enough to skip the `finally` below
      // and leave delivery_locked_at stuck inside the staleness
      // window — the two look identical from here. Either way this
      // broadcast was due and did NOT send this tick, which is worth
      // a line even though it isn't an error.
      console.log(
        `[content-cron] skipped broadcast ${broadcast.id}: could not claim delivery lock (already claimed, or a stale lock hasn't expired yet)`
      );
      continue;
    }

    try {
      await deliverContentBroadcast(admin, broadcast);
      sent += 1;
    } catch (err) {
      console.error(
        `[content-cron] delivery failed for broadcast ${broadcast.id}:`,
        err
      );
    } finally {
      await releaseBroadcastDelivery(admin, broadcast.id);
    }
  }

  return NextResponse.json({ sent });
}
