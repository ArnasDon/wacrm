import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runHandoffLessonDetector } from '@/lib/ai/flywheel'

/**
 * GET /api/ai/flywheel — list this account's suggestion queue (any member).
 * POST /api/ai/flywheel — run the detector on demand for this account only
 * (admin+), mirroring the nightly cron but scoped and immediate.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('agent_suggestions')
      .select('id, kind, status, title, content, evidence, created_at, applied_at, dismissed_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('[ai/flywheel GET] error:', error)
      return NextResponse.json({ error: 'Failed to load suggestions' }, { status: 500 })
    }
    return NextResponse.json({ suggestions: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST() {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-flywheel-run:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    // Detector writes with the service-role client: drafted suggestions are
    // system-authored, and authenticated sessions only have SELECT/UPDATE
    // on agent_suggestions (a client can review and apply, never forge one).
    const result = await runHandoffLessonDetector(supabaseAdmin(), { accountId, limit: 5 })
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
