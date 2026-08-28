import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * Supabase keep-alive heartbeat.
 *
 * Free-tier (and some paid-tier) Supabase projects pause after a
 * stretch of no activity. This endpoint exists purely to generate a
 * real, minimal request against the database on a schedule — it has
 * no CRM functionality of its own. Point an EXTERNAL scheduler at it
 * (Vercel Cron, GitHub Actions, cron-job.org, ...); nothing inside
 * this app or the user's browser triggers it. A React-side
 * `setInterval` would only run while a tab happens to be open, which
 * defeats the purpose — this must fire even when the CRM is not
 * being used by anyone.
 *
 * Query: `select('id').limit(1)` on `accounts` — the smallest safe
 * read that still touches real table storage (not just an auth
 * ping), so Supabase sees genuine database activity. Strictly
 * read-only; no row is ever written. `accounts` is used (rather than
 * a dedicated healthcheck table/RPC) because it always exists in any
 * deployment of this app and needs no new migration — nothing new
 * was added to the database for this.
 *
 * Auth: a DEDICATED secret (HEARTBEAT_SECRET, separate from
 * AUTOMATION_CRON_SECRET — this is an infra/ops concern, not a
 * business-automation one) via `Authorization: Bearer <secret>`,
 * compared with `timingSafeEqual` (same discipline as
 * /api/automations/cron and /api/flows/cron) so a byte-by-byte
 * timing attack can't recover it. Returns 503 until the variable is
 * set, and 401 on any mismatch — never runs unauthenticated.
 *
 * Reuses the account-wide lazy service-role client already used by
 * the automations engine (src/lib/automations/admin-client.ts) —
 * no new Supabase client was created for this endpoint.
 *
 * Hosting/frequency: this only needs to run often enough to stay
 * under whatever inactivity window your Supabase plan enforces —
 * once every 6–12 hours is already generous for that. Once every 15
 * minutes to once daily are all reasonable; there is no benefit to
 * anything sub-minute. See docs/docker.md for the external-scheduler
 * pattern this project already uses for its other cron endpoints.
 */
async function runHeartbeat(request: Request): Promise<NextResponse> {
  const expected = process.env.HEARTBEAT_SECRET
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'heartbeat not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const supplied = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  try {
    const { error } = await supabaseAdmin().from('accounts').select('id').limit(1)
    if (error) throw error

    return NextResponse.json({
      ok: true,
      message: 'Supabase heartbeat succeeded.',
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[heartbeat] Supabase query failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { ok: false, error: 'Heartbeat query failed.', timestamp: new Date().toISOString() },
      { status: 502 },
    )
  }
}

// Both verbs accepted — most cron/pinger services default to GET, but
// some (and some webhook-style dashboards) prefer POST. Same secret
// check either way.
export async function GET(request: Request) {
  return runHeartbeat(request)
}

export async function POST(request: Request) {
  return runHeartbeat(request)
}
