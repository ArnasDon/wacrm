import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reprocessFailedApprovalForwards } from '@/lib/eter/aisdr-approval-forward'
import { getCronHeartbeat, recordCronHeartbeat } from '@/lib/eter/repo/cron-heartbeats.repo'
import { checkCronStaleness } from '@/lib/eter/cron-liveness'

// Intended schedule: every 15 minutes (see docs/eter-agent-config.md
// for the exact crontab line) — same cadence as the sibling
// /api/eter-agent/cron (follow-ups/reminders). Threshold: 3x the
// interval (45 min) — see checkCronStaleness's doc comment for the
// rationale (tolerates one missed tick, still catches a genuinely
// broken scheduler within under an hour).
const CRON_NAME = 'aisdr-approvals-reprocess'
const STALE_THRESHOLD_MS = 45 * 60 * 1000

/**
 * Drains `aisdr_approval_forwards` rows stuck in `failed` (every retry
 * inside the original webhook-time attempt group was exhausted — see
 * forwardApprovalDecision in src/lib/eter/aisdr-approval-forward.ts)
 * for another attempt group, up to MAX_QUEUE_ATTEMPTS before giving up
 * for good.
 *
 * Same auth pattern as /api/eter-agent/cron and /api/automations/cron:
 * a shared secret via `x-cron-secret` matching `AUTOMATION_CRON_SECRET`
 * (reused rather than a new env var, one cron secret to provision, not
 * two). Scheduling command + liveness-alert rationale documented in
 * docs/eter-agent-config.md.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Liveness check BEFORE the sweep, against the PREVIOUS heartbeat —
  // see checkCronStaleness's doc comment for why this only catches "the
  // cron fired but kept failing", not "the cron was never scheduled at
  // all" (that case needs external monitoring, out of scope here).
  const previousHeartbeat = await getCronHeartbeat(admin, CRON_NAME).catch((err) => {
    console.error('[aisdr-approvals-cron] failed to read previous heartbeat:', err)
    return null
  })
  await checkCronStaleness({ cronName: CRON_NAME, thresholdMs: STALE_THRESHOLD_MS, previousHeartbeat })

  const result = await reprocessFailedApprovalForwards(admin, { limit: 50 })

  // Record the heartbeat AFTER a successful sweep — a thrown error
  // above (the sweep itself, not this recording) skips this and the
  // next invocation's staleness check will correctly see the gap
  // growing. Best-effort: a failure to WRITE the heartbeat must not
  // fail the cron response, the sweep itself already completed.
  await recordCronHeartbeat(admin, CRON_NAME, result).catch((err) =>
    console.error('[aisdr-approvals-cron] failed to record heartbeat:', err),
  )

  return NextResponse.json({ ...result, staleThresholdMs: STALE_THRESHOLD_MS })
}
