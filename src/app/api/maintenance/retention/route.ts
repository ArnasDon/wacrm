import { timingSafeEqual } from 'node:crypto';
import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { runDailyRetention } from '@/lib/maintenance/retention';

// The run is time-boxed below this (retentionConfig().budgetMs).
export const maxDuration = 300;

/**
 * Daily data retention (data older than DATA_RETENTION_DAYS, except
 * profiles / accounts). For serverless hosts, where the in-process
 * scheduler (src/instrumentation.ts) doesn't run: point a cron at this
 * once a day (or more often — it runs at most once per UTC day) with the
 * `x-cron-secret` header = AUTOMATION_CRON_SECRET.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected)
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '');
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();
  after(async () => {
    await runDailyRetention(db);
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
