import { getPool } from '@/lib/db/pool';
import { claimDueAutomations } from '@/lib/db/jobs';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { resumePendingExecution } from '@/lib/automations/engine';

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
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

  try {
    const due = await claimDueAutomations(getPool('worker'));
    for (const pending of due) await resumePendingExecution(pending);
    return NextResponse.json({ processed: due.length });
  } catch {
    return NextResponse.json(
      { error: 'Unable to process automation waits.' },
      { status: 500 }
    );
  }
}
