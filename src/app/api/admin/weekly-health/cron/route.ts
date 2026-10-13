import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { loadWeeklyHealth, renderWeeklyHealthEmail, sendWeeklyHealthEmail } from '@/lib/admin/weekly-health'
import { recordHeartbeat } from '@/lib/observability/heartbeat'

/**
 * Monday 07:10 (Guatemala) health email to the platform owner. Same
 * `x-cron-secret` pattern as the subscriptions cron, whose secret it
 * falls back to so no new EasyPanel env var is needed.
 * `?dry_run=true` returns the email without sending it.
 */
export async function GET(request: Request) {
  const expected = process.env.WEEKLY_HEALTH_CRON_SECRET || process.env.SUBSCRIPTIONS_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const expectedBuf = Buffer.from(expected)
  if (supplied.length !== expectedBuf.length || !timingSafeEqual(supplied, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = platformAdminClient()
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://chatsandia.com'

  if (new URL(request.url).searchParams.get('dry_run') === 'true') {
    return NextResponse.json({ dry_run: true, ...renderWeeklyHealthEmail(await loadWeeklyHealth(db), siteUrl) })
  }

  const result = await sendWeeklyHealthEmail(db, siteUrl)
  await recordHeartbeat('weekly_health_cron', { detail: result.subject })
  return NextResponse.json(result)
}
