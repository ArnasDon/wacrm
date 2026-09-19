import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { hashInviteToken } from '@/lib/auth/invitations'
import { redeemInvitation } from '@/lib/auth/team'
import { ValidationError } from '@/lib/http/errors'
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/** POST — signed-in caller joins the inviting account. */
export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const limit = checkRateLimit(`redeem:${getClientIp(request)}`, RATE_LIMITS.invitationRedeem)
  if (!limit.success) return rateLimitResponse(limit)
  try {
    const me = await getCurrentAccount()
    const { token } = await ctx.params
    if (!token || token.length > 100) throw new ValidationError('Missing invitation token')
    const accountId = await redeemInvitation(me.userId, hashInviteToken(token))
    return NextResponse.json({ ok: true, accountId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
