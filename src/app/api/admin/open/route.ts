import { NextResponse } from 'next/server'
import { ACTING_ACCOUNT_COOKIE, requirePlatformAdmin } from '@/lib/auth/platform'
import { parseId } from '@/lib/db/ids'
import { getDb } from '@/lib/db/mongo'
import type { AccountDoc } from '@/lib/db/types'
import { NotFoundError, readJson, toErrorResponse } from '@/lib/http/errors'

// ============================================================
// "Open this merchant" — the platform admin steps into an account to
// set up its WhatsApp, AI, Telegram and storage.
//
// The account id lives in a cookie rather than the URL so every
// existing settings screen keeps working unchanged. It only means
// anything for a session that is already a platform admin: for anyone
// else the cookie is ignored outright.
// ============================================================

/** POST { accountId } — work inside this merchant's account. */
export async function POST(request: Request) {
  try {
    await requirePlatformAdmin()
    const body = await readJson(request)
    const id = parseId(body.accountId)
    const db = await getDb()
    const account = await db.collection<AccountDoc>('accounts').findOne({ _id: id }, { projection: { name: 1 } })
    if (!account) throw new NotFoundError('Account not found')

    const res = NextResponse.json({ ok: true, account: { id: account._id, name: account.name } })
    res.cookies.set(ACTING_ACCOUNT_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 8 * 60 * 60,
    })
    return res
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE — back to your own account. */
export async function DELETE() {
  try {
    await requirePlatformAdmin()
    const res = NextResponse.json({ ok: true })
    res.cookies.delete(ACTING_ACCOUNT_COOKIE)
    return res
  } catch (err) {
    return toErrorResponse(err)
  }
}
