import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAccountRole } from '@/lib/auth/roles'
import { removeMember, setMemberRole } from '@/lib/auth/team'
import { parseId } from '@/lib/db/ids'
import { readJson, ValidationError } from '@/lib/http/errors'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function PATCH(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  try {
    const actor = await requireRole('admin')
    const limit = checkRateLimit(`admin:${actor.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const userId = parseId((await ctx.params).userId, 'userId')
    const body = await readJson(request)
    if (!isAccountRole(body.role)) throw new ValidationError("'role' must be admin, agent or viewer")
    await setMemberRole(actor, userId, body.role)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ userId: string }> }) {
  try {
    const actor = await requireRole('admin')
    const limit = checkRateLimit(`admin:${actor.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const userId = parseId((await ctx.params).userId, 'userId')
    const result = await removeMember(actor, userId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
