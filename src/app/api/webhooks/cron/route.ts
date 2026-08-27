import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'
import { retryDelivery } from '@/lib/webhooks/deliver'
import { recordHeartbeat } from '@/lib/observability/heartbeat'
import type { WebhookEvent } from '@/lib/webhooks/events'

/**
 * Drain due `webhook_deliveries` retries. Meant to be hit on a
 * schedule (Vercel Cron / external pinger), same pattern as
 * src/app/api/automations/cron/route.ts — requires a shared secret via
 * the `x-cron-secret` header matching `WEBHOOK_CRON_SECRET`.
 *
 * The claim step (flip to 'processing') mirrors the automations cron's
 * claim-then-process shape: a two-step UPDATE-by-id-and-status so
 * overlapping invocations don't double-process the same row.
 * `retryDelivery` sets the row's real terminal/next state once the
 * attempt resolves.
 */
export async function GET(request: Request) {
  const expected = process.env.WEBHOOK_CRON_SECRET
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
  const { data: due, error } = await admin
    .from('webhook_deliveries')
    .select('id, endpoint_id, event, attempt_count, payload')
    .eq('status', 'pending')
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(50)

  if (error) {
    await recordHeartbeat('webhooks_cron', { status: 'error', detail: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!due || due.length === 0) {
    await recordHeartbeat('webhooks_cron')
    return NextResponse.json({ processed: 0 })
  }

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('webhook_deliveries')
      .update({ status: 'processing' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await retryDelivery(admin, {
      id: row.id as string,
      endpoint_id: row.endpoint_id as string,
      event: row.event as WebhookEvent,
      attempt_count: row.attempt_count as number,
      payload: row.payload,
    })
    processed++
  }

  await recordHeartbeat('webhooks_cron', { detail: `processed ${processed}` })
  return NextResponse.json({ processed })
}
