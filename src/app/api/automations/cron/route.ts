import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  claimPendingExecution,
  expireAwaitingReplies,
  requeueStalledExecutions,
  resumePendingExecution,
} from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

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
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule — authenticated one of two ways:
 *
 *   - Vercel Cron: sends `Authorization: Bearer <CRON_SECRET>` and
 *     cannot set custom headers, so it's matched against `CRON_SECRET`.
 *   - External pinger (cron-job.org, etc.): sends the `x-cron-secret`
 *     header, matched against `AUTOMATION_CRON_SECRET`.
 *
 * Either secret being configured + presented is sufficient. If neither
 * env var is set the endpoint is disabled (503).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const pingerSecret = process.env.AUTOMATION_CRON_SECRET

  if (!cronSecret && !pingerSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }

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

  return runCronDrain()
}

/**
 * The actual drain. Split out from `GET` so both auth paths share it.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
async function runCronDrain() {
  // Close out wait_for_reply runs whose 24h reply window lapsed. The
  // webhook already refuses to resume them; this just settles their
  // status and explains the outcome on the log.
  const expired = await expireAwaitingReplies()
  const requeued = await requeueStalledExecutions()

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0, expired, requeued })

  let processed = 0
  for (const row of due) {
    if (!(await claimPendingExecution(row.id as string))) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      parked_step_id: (row.parked_step_id as string | null) ?? null,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  return NextResponse.json({ processed, expired, requeued })
}
