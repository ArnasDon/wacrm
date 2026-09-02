import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runFollowupSweep } from '@/lib/ai/followups-sweep'
import { recordHeartbeat } from '@/lib/observability/heartbeat'

/**
 * Send due follow-up nudges for accounts that opted in
 * (`ai_configs.followups_enabled`). Meant to be hit on a schedule
 * (pg_cron — see migration 100) with the `x-cron-secret` header
 * matching `FOLLOWUPS_CRON_SECRET`, or `AUTOMATION_CRON_SECRET` as a
 * fallback so operators can reuse the secret the automations/flows
 * jobs already use.
 *
 * The per-step idempotency lives in `ai_followup_log` (one row per
 * attempt, unique on conversation + streak + step index), so an
 * accidental double invocation can't double-send.
 */
export async function GET(request: Request) {
  const expected =
    process.env.FOLLOWUPS_CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET
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
    const result = await runFollowupSweep(supabaseAdmin())
    await recordHeartbeat('followups_cron', {
      detail: `sent ${result.sent}, failed ${result.failed}, scanned ${result.scanned}`,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[followups/cron] sweep failed:', message)
    await recordHeartbeat('followups_cron', { status: 'error', detail: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
