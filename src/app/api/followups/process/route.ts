import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { runFollowupReminders } from '@/lib/followups/process'

// Fallback for deployments without a scheduler: the app calls this when a
// signed-in user opens WACRM, so due reminders still appear in the bell.
// Idempotent, so extra calls are harmless.
export async function POST() {
  try {
    const { userId } = await requireRole('viewer')
    const limit = checkRateLimit(`followup-sweep:${userId}`, { limit: 6, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)
    return NextResponse.json(await runFollowupReminders())
  } catch (err) {
    return toErrorResponse(err)
  }
}
