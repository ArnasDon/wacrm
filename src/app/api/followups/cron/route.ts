import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runFollowupReminders } from '@/lib/followups/process'

/**
 * Scheduler hook: call every ~15 minutes with the shared secret
 * (same `AUTOMATION_CRON_SECRET` the other cron endpoints use).
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const want = Buffer.from(expected)
  if (supplied.length !== want.length || !timingSafeEqual(supplied, want)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runFollowupReminders())
}
