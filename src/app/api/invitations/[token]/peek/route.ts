import { NextResponse } from 'next/server'
import { hashInviteToken } from '@/lib/auth/invitations'
import { peekInvitation } from '@/lib/auth/team'
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET — public preview of an invite (account name + role) so the
 * join page can show what's being accepted. Rate-limited per IP;
 * tokens are 256-bit so enumeration is impractical anyway.
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const limit = checkRateLimit(`peek:${getClientIp(request)}`, RATE_LIMITS.invitationPeek)
  if (!limit.success) return rateLimitResponse(limit)
  const { token } = await ctx.params
  if (!token || token.length > 100) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }
  try {
    return NextResponse.json(await peekInvitation(hashInviteToken(token)))
  } catch (err) {
    console.error('[peek] error:', err)
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 })
  }
}
