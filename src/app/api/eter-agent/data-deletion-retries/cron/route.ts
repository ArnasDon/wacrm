import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reprocessFailedDataDeletionInserts } from '@/lib/eter/data-deletion'
import { getCronHeartbeat, recordCronHeartbeat } from '@/lib/eter/repo/cron-heartbeats.repo'
import { checkCronStaleness } from '@/lib/eter/cron-liveness'

// Intended schedule: every 15 minutes, same cadence as the sibling
// /api/eter-agent/aisdr-approvals/cron — see docs/eter-agent-config.md
// for the exact crontab line. Threshold: 3x the interval (45 min),
// same rationale as that cron (tolerates one missed tick, still
// catches a genuinely broken scheduler within under an hour) — an RGPD
// deletion request stuck in the retry queue is at least as sensitive
// as a stuck approval.
const CRON_NAME = 'data-deletion-inserts-reprocess'
const STALE_THRESHOLD_MS = 45 * 60 * 1000

/**
 * Drains `data_deletion_insert_failures` rows stuck in `failed` —
 * inbound "APAGAR" commands whose INSERT into `data_deletion_requests`
 * failed at webhook time (see src/lib/eter/data-deletion.ts) — for
 * another retry attempt, up to MAX_INSERT_RETRY_ATTEMPTS before giving
 * up for good.
 *
 * Same auth pattern as every other internal cron in this app: a
 * shared secret via `x-cron-secret` matching `AUTOMATION_CRON_SECRET`.
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

  const previousHeartbeat = await getCronHeartbeat(admin, CRON_NAME).catch((err) => {
    console.error('[data-deletion-retries-cron] failed to read previous heartbeat:', err)
    return null
  })
  await checkCronStaleness({ cronName: CRON_NAME, thresholdMs: STALE_THRESHOLD_MS, previousHeartbeat })

  const result = await reprocessFailedDataDeletionInserts(admin, { limit: 50 })

  await recordCronHeartbeat(admin, CRON_NAME, result).catch((err) =>
    console.error('[data-deletion-retries-cron] failed to record heartbeat:', err),
  )

  return NextResponse.json({ ...result, staleThresholdMs: STALE_THRESHOLD_MS })
}
