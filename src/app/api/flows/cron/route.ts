import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { checkRunTimeout, markRunTimedOut } from '@/lib/flows/timeout'

const TIMEOUT_SWEEP_PAGE_SIZE = 500
const TIMEOUT_SWEEP_MAX_PAGES = 20

interface TimedOutRunRow {
  id: string
  last_advanced_at: string
  fallback_policy: unknown
}

/**
 * Sweep abandoned active flow runs.
 *
 * Reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h), then marks any run
 * past its cutoff as `timed_out`. Writes a matching `flow_run_events`
 * row for the audit trail.
 *
 * Without this sweep, a customer who abandons a flow mid-conversation
 * keeps a row in `idx_one_active_run_per_contact` (the partial unique
 * index on `flow_runs WHERE status='active'`) forever — blocking any
 * new triggers for them. The cron is therefore not optional.
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET` so operators only have one
 * secret to provision. The two endpoints (`/api/automations/cron`
 * and this one) are independent operations; we keep them on separate
 * URLs so one failing doesn't block the other.
 *
 * Hosting: hit on a schedule (Vercel Cron / GitHub Actions / external
 * pinger). A 5-minute interval is more than enough for a 24h timeout
 * default; once per hour would also be acceptable for low-volume
 * tenants.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  // Constant-time compare so an attacker who can hit the endpoint
  // can't recover the secret byte-by-byte from response-time deltas.
  // Length pre-check is required by timingSafeEqual (throws otherwise)
  // and leaks only the length itself, which isn't sensitive.
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
  const now = new Date()

  let swept = 0
  for (let page = 0; page < TIMEOUT_SWEEP_MAX_PAGES; page += 1) {
    const { data: runs, error } = await admin.rpc('list_timed_out_flow_runs', {
      p_now: now.toISOString(),
      p_limit: TIMEOUT_SWEEP_PAGE_SIZE,
    })
    if (error) {
      console.error('[flows-cron] timed-out run scan failed:', error.message)
      return NextResponse.json({ error: error.message, swept }, { status: 500 })
    }

    const rows = (runs ?? []) as TimedOutRunRow[]
    let sweptThisPage = 0
    for (const r of rows) {
      const check = checkRunTimeout(r.last_advanced_at, r.fallback_policy, now)
      if (!check.timedOut) continue
      if (await markRunTimedOut(admin, r.id, check, 'stale_sweep', now)) {
        sweptThisPage += 1
      }
    }
    swept += sweptThisPage

    if (rows.length < TIMEOUT_SWEEP_PAGE_SIZE || sweptThisPage === 0) break
  }

  return NextResponse.json({ swept })
}
