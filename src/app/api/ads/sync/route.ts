// ============================================================
// /api/ads/sync
//
//   POST — "Sync now" button in Settings. Admin+, syncs only the
//          caller's own account.
//   GET  — scheduled sync across every connected account. Meant to be
//          hit on a schedule (n8n, on the same VPS Coolify runs) and
//          gated by a shared secret, exactly like
//          /api/automations/cron — same header, same env var, so
//          operators only have one cron secret to manage.
// ============================================================

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ads/admin-client'
import { syncAllAdAccounts } from '@/lib/ads/sync'

export async function POST() {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(`admin:adsSyncNow:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const results = await syncAllAdAccounts(supabaseAdmin(), ctx.accountId)
    return NextResponse.json({ results })
  } catch (err) {
    return toErrorResponse(err)
  }
}

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

  try {
    const results = await syncAllAdAccounts(supabaseAdmin())
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[GET /api/ads/sync] cron sync failed:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
