import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getDb } from '@/lib/db/mongo'
import type { OAuthStateDoc } from '@/lib/db/types'
import { getAppBaseUrl } from '@/lib/http/base-url'
import { ValidationError } from '@/lib/http/errors'

/**
 * GET — start "Connect Gmail". Scope is gmail.send only (send as the
 * merchant; no reading their mailbox). The `state` is a random,
 * single-use, 10-minute token bound to this account + user — the
 * callback refuses anything else (CSRF / account-mixing protection).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new ValidationError('Gmail sign-in is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)')
    }
    const state = randomBytes(24).toString('base64url')
    const db = await getDb()
    await db.collection<OAuthStateDoc>('oauth_states').insertOne({
      _id: state,
      accountId: ctx.accountId,
      userId: ctx.userId,
      purpose: 'gmail',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${getAppBaseUrl(request)}/api/integrations/gmail/callback`,
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/gmail.send',
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
    return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  } catch (err) {
    return toErrorResponse(err)
  }
}
