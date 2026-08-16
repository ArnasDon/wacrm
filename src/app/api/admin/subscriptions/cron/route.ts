import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { findOverdueAccounts, suspendOverdueAccounts } from '@/lib/admin/subscriptions'

/**
 * Daily subscription-suspension sweep. Same secret-header pattern as
 * src/app/api/conversations/cron/route.ts and the other pg_cron-driven
 * routes — requires `x-cron-secret` to match `SUBSCRIPTIONS_CRON_SECRET`.
 *
 * `?dry_run=true` runs the read-only check (which accounts WOULD be
 * suspended right now) without mutating anything — this is the exact
 * safety check promised before ever scheduling the real pg_cron job:
 * hit this URL with dry_run once, review the list with Angel, only
 * then register the daily schedule.
 */
export async function GET(request: Request) {
  const expected = process.env.SUBSCRIPTIONS_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = platformAdminClient()
  const dryRun = new URL(request.url).searchParams.get('dry_run') === 'true'

  if (dryRun) {
    const wouldSuspend = await findOverdueAccounts(db)
    return NextResponse.json({ dry_run: true, would_suspend: wouldSuspend })
  }

  const result = await suspendOverdueAccounts(db)
  return NextResponse.json(result)
}
