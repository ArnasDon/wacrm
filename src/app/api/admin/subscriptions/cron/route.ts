import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformAdminClient } from '@/lib/platform/admin-client'
import {
  findAccountsDueInDays,
  findOverdueAccounts,
  sendSubscriptionAlerts,
} from '@/lib/admin/subscriptions'
import { recordHeartbeat } from '@/lib/observability/heartbeat'

/**
 * Daily subscription-alert sweep. Same secret-header pattern as
 * src/app/api/conversations/cron/route.ts and the other pg_cron-driven
 * routes — requires `x-cron-secret` to match `SUBSCRIPTIONS_CRON_SECRET`.
 *
 * Never suspends anything automatically (Angel's explicit call,
 * 2026-08-16) — it only emails PAYMENTS_INBOX: once when an account
 * hits its 3-day warning, and daily while an account sits overdue.
 * Angel reviews and suspends by hand from /admin ("Suspender").
 *
 * `?dry_run=true` returns which accounts WOULD trigger each alert right
 * now, without sending anything — the safety check to run once and
 * review before registering the daily pg_cron schedule.
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
    const [dueSoon, overdue] = await Promise.all([
      findAccountsDueInDays(db, 3),
      findOverdueAccounts(db),
    ])
    return NextResponse.json({ dry_run: true, due_soon: dueSoon, overdue })
  }

  const result = await sendSubscriptionAlerts(db)
  await recordHeartbeat('subscriptions_cron', {
    detail: `dueSoon ${result.dueSoon.length}, overdue ${result.overdue.length}`,
  })
  return NextResponse.json(result)
}
