import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/conversations/admin-client'
import { reassignUnclaimedConversations } from '@/lib/conversations/reassign'
import { pruneEmptyStaleConversations } from '@/lib/conversations/prune-empty'
import { recordHeartbeat } from '@/lib/observability/heartbeat'

/**
 * Auto-assigns open conversations that have sat unclaimed past their
 * account's configured timeout to an available advisor. Meant to be hit
 * on a schedule (pg_cron / external pinger), same secret-header pattern
 * as src/app/api/webhooks/cron/route.ts and
 * src/app/api/automations/cron/route.ts — requires `x-cron-secret` to
 * match `CONVERSATIONS_CRON_SECRET`.
 *
 * The atomic claim (`UPDATE ... WHERE assigned_agent_id IS NULL`) lives
 * in `reassignUnclaimedConversations` itself — unlike the other crons,
 * no intermediate 'processing' status is needed here since that one
 * UPDATE is already the claim.
 */
export async function GET(request: Request) {
  const expected = process.env.CONVERSATIONS_CRON_SECRET
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

  const result = await reassignUnclaimedConversations(supabaseAdmin())
  const pruned = await pruneEmptyStaleConversations(supabaseAdmin()).catch((err) => {
    console.error('[conversations/cron] prune failed:', err)
    return { pruned: 0 }
  })
  await recordHeartbeat('conversations_cron')
  return NextResponse.json({ ...result, ...pruned })
}
