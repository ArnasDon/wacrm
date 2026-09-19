import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { canManageMembers } from '@/lib/auth/roles'
import { getDb } from '@/lib/db/mongo'
import type { UserDoc } from '@/lib/db/types'

/** GET /api/account/members — everyone in the caller's account. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const db = await getDb()
    const rows = await db
      .collection<UserDoc>('users')
      .find({ accountId: ctx.accountId }, { projection: { passwordHash: 0 } })
      .sort({ createdAt: 1 })
      .toArray()
    // Emails are visible to admins+ only.
    const canSeeEmails = canManageMembers(ctx.role)
    return NextResponse.json({
      members: rows.map((u) => ({
        user_id: u._id,
        full_name: u.fullName ?? '',
        email: canSeeEmails || u._id === ctx.userId ? u.email : null,
        avatar_url: u.avatarUrl,
        role: u.role,
        joined_at: u.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
