import { NextResponse } from 'next/server'
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { destroyAllSessions, hashToken } from '@/lib/auth/session'
import { getDb } from '@/lib/db/mongo'
import type { UserDoc } from '@/lib/db/types'
import { readJson, toErrorResponse, ValidationError } from '@/lib/http/errors'
import { str } from '@/lib/http/validate'
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/** POST { token, password } — consume a reset token (single use), sign out everywhere. */
export async function POST(request: Request) {
  const limit = checkRateLimit(`reset-use:${getClientIp(request)}`, RATE_LIMITS.login)
  if (!limit.success) return rateLimitResponse(limit)
  try {
    const body = await readJson(request)
    const token = str(body.token, 'token', { max: 200 })
    const password = str(body.password, 'password', { min: MIN_PASSWORD_LENGTH, max: 200, trim: false })
    const db = await getDb()
    const reset = await db
      .collection<{ _id: string; tokenHash: string; userId: string; expiresAt: Date }>('password_resets')
      .findOneAndDelete({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
    if (!reset) throw new ValidationError('This reset link is invalid or has expired')
    await db
      .collection<UserDoc>('users')
      .updateOne({ _id: reset.userId }, { $set: { passwordHash: await hashPassword(password), updatedAt: new Date() } })
    await destroyAllSessions(reset.userId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
