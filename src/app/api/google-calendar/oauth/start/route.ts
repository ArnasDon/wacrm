import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildAuthUrl, GoogleCalendarError, OAUTH_STATE_COOKIE } from '@/lib/google-calendar/oauth'

/**
 * GET /api/google-calendar/oauth/start  (admin+)
 *
 * Kicks off the Authorization Code flow: stashes a random anti-CSRF
 * `state` in a short-lived httpOnly cookie, then redirects the browser
 * to Google's consent screen. The callback (same browser, same
 * first-party cookies) compares the returned `state` against this
 * cookie and re-derives the account from the caller's still-active
 * session — nothing about the account needs to be encoded in `state`
 * itself.
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
      maxAge: 600, // 10 minutes — plenty for a human to complete Google's consent screen
    })

    return NextResponse.redirect(buildAuthUrl(state))
  } catch (err) {
    if (err instanceof GoogleCalendarError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
