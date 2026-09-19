import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  clampExpiryDays,
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from '@/lib/auth/invitations'
import { scopedCollection } from '@/lib/db/scoped'
import type { InvitationDoc } from '@/lib/db/types'
import { getAppBaseUrl } from '@/lib/http/base-url'
import { readJson } from '@/lib/http/errors'
import { oneOf, optStr } from '@/lib/http/validate'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function shape(inv: InvitationDoc) {
  return {
    id: inv._id,
    role: inv.role,
    label: inv.label,
    created_at: inv.createdAt.toISOString(),
    expires_at: inv.expiresAt.toISOString(),
  }
}

/** GET — pending (unaccepted, unexpired) invitations. Admin+. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const invitations = await scopedCollection<InvitationDoc>(ctx, 'invitations')
    const rows = await invitations
      .find({ acceptedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()
    return NextResponse.json({ invitations: rows.map(shape) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST — create an invite link. The plaintext token is returned ONCE. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:inviteCreate:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await readJson(request)
    const role = oneOf(body.role, 'role', ['admin', 'agent', 'viewer'] as const)
    const expiryDays = clampExpiryDays(typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined)
    const label = optStr(body.label, 'label', 80)

    const { token, hash } = generateInviteToken()
    const invitations = await scopedCollection<InvitationDoc>(ctx, 'invitations')
    const inv = await invitations.insertOne({
      tokenHash: hash,
      role,
      label,
      createdByUserId: ctx.userId,
      expiresAt: inviteExpiresAt(expiryDays),
      acceptedAt: null,
      acceptedByUserId: null,
    })
    return NextResponse.json(
      {
        invitation: shape(inv),
        token,
        url: inviteUrl(token, getAppBaseUrl(request)),
        expiresInDays: expiryDays,
      },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
