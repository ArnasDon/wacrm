import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildAuthUrl, GoogleSheetsError, OAUTH_STATE_COOKIE } from '@/lib/google-sheets/oauth'

/**
 * GET /api/google-sheets/oauth/start  (admin+)
 *
 * Same Authorization Code kickoff as
 * src/app/api/google-calendar/oauth/start — random anti-CSRF `state`
 * in a short-lived httpOnly cookie, then redirect to Google's consent
 * screen.
 */
export async function GET() {
  try {
    await requireRole('admin')

    const state = crypto.randomBytes(16).toString('hex')
    const cookieStore = await cookies()
    cookieStore.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })

    return NextResponse.redirect(buildAuthUrl(state))
  } catch (err) {
    if (err instanceof GoogleSheetsError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
