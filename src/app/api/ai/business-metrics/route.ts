import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadBusinessMetrics } from '@/lib/ai/business-metrics'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET() {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = await checkSharedRateLimit(`ai-metrics:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)
    return NextResponse.json(await loadBusinessMetrics(supabase, accountId))
  } catch (error) {
    return toErrorResponse(error)
  }
}
