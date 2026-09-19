import { NextResponse } from 'next/server'
import { verifyAgainstDummy, verifyPassword } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/mongo'
import type { UserDoc } from '@/lib/db/types'
import { readJson, toErrorResponse, UnauthorizedError } from '@/lib/http/errors'
import { email as emailV, str } from '@/lib/http/validate'
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const ipLimit = checkRateLimit(`login-ip:${getClientIp(request)}`, RATE_LIMITS.login)
  if (!ipLimit.success) return rateLimitResponse(ipLimit)

  try {
    const body = await readJson(request)
    const email = emailV(body.email)
    const password = str(body.password, 'password', { max: 200, trim: false })

    const emailLimit = checkRateLimit(`login-email:${email}`, RATE_LIMITS.login)
    if (!emailLimit.success) return rateLimitResponse(emailLimit)

    const db = await getDb()
    const user = await db.collection<UserDoc>('users').findOne({ email })
    if (!user) {
      await verifyAgainstDummy(password)
      throw new UnauthorizedError('Invalid email or password')
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password')
    }

    await db
      .collection<UserDoc>('users')
      .updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } })
    await createSession(user._id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
