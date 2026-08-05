import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { drainMessageQueue } from '@/lib/automations/queue'

/**
 * Drain due `message_queue` rows (Fase 2 Mautic P1.4 — frecuencia +
 * re-agendado). Meant to be hit on a schedule (Vercel Cron / external
 * pinger) with the same shared secret as the automations cron
 * (`AUTOMATION_CRON_SECRET`) — or, simpler, called from the same
 * schedule that hits `/api/automations/cron`.
 *
 * `drainMessageQueue` owns the claim step (pending → claimed) so
 * overlapping invocations don't double-send.
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

  const result = await drainMessageQueue()
  return NextResponse.json(result)
}
