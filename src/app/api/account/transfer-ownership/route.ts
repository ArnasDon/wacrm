import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { transferOwnership } from '@/lib/auth/team'
import { parseId } from '@/lib/db/ids'
import { readJson } from '@/lib/http/errors'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/** POST { newOwnerUserId } — owner only. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const limit = checkRateLimit(`admin:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await readJson(request)
    await transferOwnership(ctx, parseId(body.newOwnerUserId, 'newOwnerUserId'))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
