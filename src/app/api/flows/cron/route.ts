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
 * Constant-time compare of two secrets. Returns false on any length
 * mismatch (which `timingSafeEqual` would otherwise throw on).
 */
function secretsMatch(supplied: string, expected: string): boolean {
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  return (
    suppliedBuf.length === expectedBuf.length &&
    timingSafeEqual(suppliedBuf, expectedBuf)
  )
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
 * Auth: accepts either Vercel Cron's `Authorization: Bearer
 * <CRON_SECRET>` (it cannot set custom headers) or an external
 * pinger's `x-cron-secret: <AUTOMATION_CRON_SECRET>`. Sharing
 * `AUTOMATION_CRON_SECRET` with `/api/automations/cron` means
 * operators provision at most one pinger secret. The two endpoints
 * are independent operations; we keep them on separate URLs so one
 * failing doesn't block the other.
 *
 * Hosting: hit on a schedule (Vercel Cron / GitHub Actions / external
 * pinger). A 5-minute interval is more than enough for a 24h timeout
 * default; once per hour would also be acceptable for low-volume
 * tenants.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const pingerSecret = process.env.AUTOMATION_CRON_SECRET

  if (!cronSecret && !pingerSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }

  // Constant-time compares so an attacker who can hit the endpoint
  // can't recover a secret byte-by-byte from response-time deltas.
  // Vercel Cron path: `Authorization: Bearer <CRON_SECRET>`.
  const authHeader = request.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const vercelOk = !!cronSecret && secretsMatch(bearer, cronSecret)

  // External-pinger path: `x-cron-secret: <AUTOMATION_CRON_SECRET>`.
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const pingerOk = !!pingerSecret && secretsMatch(supplied, pingerSecret)

  if (!vercelOk && !pingerOk) {
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
