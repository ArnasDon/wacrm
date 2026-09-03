import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'
import { runTemperatureSweep } from '@/lib/contacts/temperature-sweep'
import { recordHeartbeat } from '@/lib/observability/heartbeat'

/**
 * Auto-cool stale leads for accounts that opted in
 * (`accounts.lead_cooldown_enabled`). Meant to be hit on a schedule
 * (pg_cron — see migration 104) with the `x-cron-secret` header
 * matching `TEMPERATURE_CRON_SECRET`, or `AUTOMATION_CRON_SECRET` as a
 * fallback so operators can reuse the secret the other jobs use.
 *
 * Idempotent: each cool-down step moves a contact one notch and stamps
 * `lead_temperature_updated_at = now`, so the stability clock resets
 * and the next tick won't touch it again until another full
 * `lead_cooldown_days` has passed.
 */
export async function GET(request: Request) {
  const expected =
    process.env.TEMPERATURE_CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET
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
    const result = await runTemperatureSweep(supabaseAdmin())
    await recordHeartbeat('temperature_sweep_cron', {
      detail: `cooled ${result.cooled}, failed ${result.failed}, scanned ${result.scanned}`,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[temperature-sweep/cron] sweep failed:', message)
    await recordHeartbeat('temperature_sweep_cron', { status: 'error', detail: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
