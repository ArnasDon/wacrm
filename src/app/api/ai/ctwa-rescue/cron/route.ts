import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runCtwaRescueForAccount } from '@/lib/whatsapp/ctwa-rescue'

/**
 * Scans every account with an active AI config for CTWA leads the
 * business never responded to, whose first 24h service window is
 * about to close, and sends an AI-drafted rescue nudge for the ones
 * still eligible once business hours + a safe pre-24h slot are
 * re-verified. Meant to be hit on a schedule (external pinger — this
 * project has no built-in scheduler; see docs/docker.md), same as
 * `/api/automations/cron`, `/api/flows/cron`, and `/api/ai/followups/
 * cron`. Re-uses `AUTOMATION_CRON_SECRET` so operators only have one
 * secret to manage.
 *
 * Lives under `/api/ai/` (not `/api/whatsapp/`) deliberately —
 * `src/middleware.ts` requires an authenticated dashboard session for
 * every `/api/whatsapp/*` route except `/webhook`, which would 401
 * this cron call before it ever reached the `x-cron-secret` check
 * below. Every other cron route in the project (`/api/automations/
 * cron`, `/api/flows/cron`, `/api/ai/followups/cron`, `/api/ai/
 * learning/cron`) avoids `/api/whatsapp/*` for the same reason.
 *
 * An AI config is required (the rescue message is AI-generated, spec
 * section 11) — accounts without one are skipped, same gate the
 * follow-up cron uses.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
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

  const admin = supabaseAdmin()

  const { data: activeConfigs, error } = await admin
    .from('ai_configs')
    .select('account_id')
    .eq('is_active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!activeConfigs || activeConfigs.length === 0) {
    return NextResponse.json({
      accounts_processed: 0,
      candidates: 0,
      sent: 0,
      cancelled: 0,
      failed: 0,
      waiting: 0,
    })
  }

  let candidates = 0
  let sent = 0
  let cancelled = 0
  let failed = 0
  let waiting = 0
  for (const row of activeConfigs) {
    try {
      const result = await runCtwaRescueForAccount(admin, row.account_id as string)
      candidates += result.candidates
      sent += result.sent
      cancelled += result.cancelled
      failed += result.failed
      waiting += result.waiting
    } catch (err) {
      console.error('[ctwa-rescue/cron] account', row.account_id, 'failed:', err)
    }
  }

  return NextResponse.json({
    accounts_processed: activeConfigs.length,
    candidates,
    sent,
    cancelled,
    failed,
    waiting,
  })
}
