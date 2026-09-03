import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/csat/admin-client'
import { runCsatSweep } from '@/lib/csat/sweep'
import { recordHeartbeat } from '@/lib/observability/heartbeat'

/**
 * Send due post-sale CSAT surveys — `csat_surveys` rows the deal.won
 * dispatch left `pending` (delay_minutes > 0) whose `send_after` has
 * elapsed. Meant to be hit on a schedule (pg_cron — see migration 104)
 * with the `x-cron-secret` header matching `CSAT_CRON_SECRET`, or
 * `AUTOMATION_CRON_SECRET` as a fallback so operators can reuse the
 * secret the automations/flows/followups jobs already use.
 *
 * Idempotency: each row is a single state machine — a send flips it to
 * `sent`/`failed`, so an accidental double invocation can't double-send.
 */
export async function GET(request: Request) {
  const expected = process.env.CSAT_CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET
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

  try {
    const result = await runCsatSweep(supabaseAdmin())
    await recordHeartbeat('csat_cron', {
      detail: `sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}, scanned ${result.scanned}`,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[csat/cron] sweep failed:', message)
    await recordHeartbeat('csat_cron', { status: 'error', detail: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
