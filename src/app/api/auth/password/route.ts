import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '@/lib/auth/password'
import { destroyAllSessions } from '@/lib/auth/session'
import { getDb } from '@/lib/db/mongo'
import type { UserDoc } from '@/lib/db/types'
import { readJson, toErrorResponse, ValidationError } from '@/lib/http/errors'
import { str } from '@/lib/http/validate'

/**
 * POST /api/auth/password — change your password. Requires the
 * current password, and signs out every OTHER session.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const body = await readJson(request)
    const current = str(body.currentPassword, 'currentPassword', { max: 200, trim: false })
    const next = str(body.newPassword, 'newPassword', {
      min: MIN_PASSWORD_LENGTH,
      max: 200,
      trim: false,
    })

    const db = await getDb()
    const user = await db.collection<UserDoc>('users').findOne({ _id: ctx.userId })
    if (!user || !(await verifyPassword(current, user.passwordHash))) {
      throw new ValidationError('Current password is incorrect')
    }
    await db
      .collection<UserDoc>('users')
      .updateOne(
        { _id: ctx.userId },
        { $set: { passwordHash: await hashPassword(next), updatedAt: new Date() } },
      )
    await destroyAllSessions(ctx.userId, ctx.sessionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
