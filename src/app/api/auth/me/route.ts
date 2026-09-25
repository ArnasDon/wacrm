import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'
import { loadAccount } from '@/lib/auth/accounts'
import { getDb } from '@/lib/db/mongo'
import type { UserDoc } from '@/lib/db/types'
import { readJson, toErrorResponse } from '@/lib/http/errors'
import { optStr } from '@/lib/http/validate'

/** GET /api/auth/me — the signed-in user, their role and account. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const account = await loadAccount(ctx.accountId)
    return NextResponse.json({
      user: {
        id: ctx.user._id,
        email: ctx.user.email,
        fullName: ctx.user.fullName,
        avatarUrl: ctx.user.avatarUrl,
      },
      role: ctx.role,
      platformAdmin: ctx.platformAdmin,
      actingAsAccount: ctx.actingAsAccount,
      account: {
        id: ctx.accountId,
        name: ctx.account.name,
        currency: account?.currency ?? 'NGN',
        hasLogo: account?.business.hasLogo ?? false,
        logoVersion: account?.business.logoVersion ?? 0,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/auth/me — edit your own profile (any role). */
export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const body = await readJson(request)
    const fullName = optStr(body.fullName, 'fullName', 120)
    const db = await getDb()
    await db
      .collection<UserDoc>('users')
      .updateOne({ _id: ctx.userId }, { $set: { fullName, updatedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
