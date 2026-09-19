import { NextResponse } from 'next/server'
import { generateToken, hashToken } from '@/lib/auth/session'
import { getDb } from '@/lib/db/mongo'
import { newId } from '@/lib/db/ids'
import type { UserDoc } from '@/lib/db/types'
import { escapeHtml, sendSystemEmail } from '@/lib/email/send'
import { getAppBaseUrl } from '@/lib/http/base-url'
import { readJson, toErrorResponse, ValidationError } from '@/lib/http/errors'
import { email as emailV } from '@/lib/http/validate'
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST { email } — email a single-use, 30-minute reset link.
 * Always answers the same way whether or not the email exists.
 */
export async function POST(request: Request) {
  const ipLimit = checkRateLimit(`reset-ip:${getClientIp(request)}`, RATE_LIMITS.passwordReset)
  if (!ipLimit.success) return rateLimitResponse(ipLimit)
  try {
    const body = await readJson(request)
    const email = emailV(body.email)
    const emailLimit = checkRateLimit(`reset-email:${email}`, RATE_LIMITS.passwordReset)
    if (!emailLimit.success) return rateLimitResponse(emailLimit)
    if (!process.env.SYSTEM_SMTP_URL) {
      throw new ValidationError('Password reset email is not configured on this server. Ask your administrator.')
    }
    const db = await getDb()
    const user = await db.collection<UserDoc>('users').findOne({ email })
    if (user) {
      const token = generateToken()
      await db.collection<{ _id: string; tokenHash: string; userId: string; expiresAt: Date }>('password_resets').insertOne({
        _id: newId(),
        tokenHash: hashToken(token),
        userId: user._id,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      })
      const link = `${getAppBaseUrl(request)}/reset-password?token=${encodeURIComponent(token)}`
      await sendSystemEmail({
        to: email,
        subject: 'Reset your password',
        text: `Reset your password: ${link}\nThis link expires in 30 minutes. If you didn't ask for this, ignore this email.`,
        html: `<p>Reset your password:</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>This link expires in 30 minutes. If you didn't ask for this, ignore this email.</p>`,
      }).catch((err) => console.error('[forgot-password] send failed', err))
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
