import { timingSafeEqual } from 'node:crypto';
import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { tickAdvancedCampaigns } from '@/lib/campaigns/advanced-scheduler';

// A pass is time-boxed below this (see passBudgetMs).
export const maxDuration = 300;

/**
 * Starts due scheduled advanced campaigns and resumes interrupted ones.
 * For serverless hosts, where there is no long-running process for the
 * in-process scheduler (src/instrumentation.ts): point a cron at this
 * every minute with the `x-cron-secret` header = AUTOMATION_CRON_SECRET.
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
    await tickAdvancedCampaigns(db, { wait: true });
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
