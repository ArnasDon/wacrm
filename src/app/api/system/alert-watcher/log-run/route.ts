import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformAdminClient } from '@/lib/platform/admin-client'

/**
 * POST /api/system/alert-watcher/log-run   { alertId, status, summary, branch?, prUrl?, testsPassed? }
 *
 * The ONLY way the "SANDIA alert watcher" cloud routine may write to
 * `system_alert_watcher_runs` — see `../log-alert/route.ts`'s own doc
 * comment for why this narrow, single-purpose endpoint replaces the
 * routine's previous raw Supabase access entirely. This is a plain
 * insert (migration 134: append-only log, one row per run) — no
 * update/delete path is exposed here on purpose, matching that
 * migration's own RLS note that only `merged_at` is ever mutated
 * later, by the human-facing accept-fix endpoint, never the routine.
 *
 * Auth: shared secret via `x-watcher-secret` header, same pattern as
 * this endpoint's sibling `../notify/route.ts` and `../log-alert/route.ts`.
 */
export async function POST(request: Request) {
  const expected = process.env.ALERT_WATCHER_NOTIFY_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-watcher-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const alertId = typeof body.alertId === 'string' ? body.alertId.trim() : ''
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  const ALLOWED_STATUSES = new Set(['pr_opened', 'diagnosed_only'])
  const status = typeof body.status === 'string' ? body.status : ''
  if (!alertId || !summary || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: 'alertId, summary, and status ("pr_opened" or "diagnosed_only") are required' },
      { status: 400 },
    )
  }

  const db = platformAdminClient()

  // Confirms the alert actually exists (the FK would reject it anyway,
  // but this gives the routine a legible error instead of a raw
  // Postgres constraint message, and can't be used to probe other
  // tables — it only ever reads system_alerts by the id it already
  // has to have on hand to call this at all).
  const { data: alert } = await db.from('system_alerts').select('id').eq('id', alertId).maybeSingle()
  if (!alert) {
    return NextResponse.json({ error: `No system_alerts row with id ${alertId}` }, { status: 404 })
  }

  const { data: run, error } = await db
    .from('system_alert_watcher_runs')
    .insert({
      alert_id: alertId,
      status,
      summary,
      branch: typeof body.branch === 'string' ? body.branch : null,
      pr_url: typeof body.prUrl === 'string' ? body.prUrl : null,
      tests_passed: typeof body.testsPassed === 'boolean' ? body.testsPassed : null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[alert-watcher/log-run] insert failed:', error.message)
    return NextResponse.json({ error: 'Failed to log run' }, { status: 500 })
  }

  return NextResponse.json({ id: run.id })
}
