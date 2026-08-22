import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireRole } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { resolveBaseUrl } from '@/lib/http/base-url'
import {
  exchangeCodeForTokens,
  fetchConnectedEmail,
  GoogleCalendarError,
  OAUTH_STATE_COOKIE,
} from '@/lib/google-calendar/oauth'

/**
 * GET /api/google-calendar/oauth/callback
 *
 * Google redirects here after the user accepts (or rejects) the
 * consent screen. No role check happens before validating `state` —
 * anyone can hit this URL with a garbage `code`, but without a
 * matching `gcal_oauth_state` cookie the exchange never proceeds.
 * `requireRole('admin')` below still gates who the connection actually
 * gets saved for, exactly like every other Settings write in this app.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  // `url.origin` resolves to the container's internal bind address
  // behind EasyPanel's reverse proxy (confirmed live 2026-08-22: a
  // real connection attempt landed on the unreachable
  // `https://0.0.0.0:80/...`) instead of the public hostname — every
  // redirect below, including the success path, must build off
  // `resolveBaseUrl(request)` instead. See src/lib/http/base-url.ts,
  // the same fix already applied to invite links and /auth/callback.
  const base = resolveBaseUrl(request)
  const settingsUrl = (params: string) => `${base}/settings?tab=google-calendar${params}`

  const error = url.searchParams.get('error')
  if (error) {
    // The user clicked "Cancel" on Google's consent screen, or Google
    // itself rejected the request (e.g. app not verified for this
    // scope + this Google account isn't a registered test user).
    return NextResponse.redirect(settingsUrl(`&error=${encodeURIComponent(error)}`))
  }

  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value
  cookieStore.delete(OAUTH_STATE_COOKIE)

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.redirect(settingsUrl('&error=invalid_state'))
  }

  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) {
      // Shouldn't happen — oauth/start always sends prompt=consent —
      // but if Google ever omits it (e.g. a policy change), fail loud
      // instead of silently saving a connection with no way to refresh.
      return NextResponse.redirect(settingsUrl('&error=no_refresh_token'))
    }
    const email = await fetchConnectedEmail(tokens.access_token)

    const row = {
      user_id: userId,
      account_id: accountId,
      refresh_token: encrypt(tokens.refresh_token),
      access_token: encrypt(tokens.access_token),
      token_expiry: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
      calendar_id: 'primary',
      calendar_email: email,
      status: 'connected' as const,
      connected_at: new Date().toISOString(),
      last_connection_error: null,
    }

    const { error: upsertError } = await supabase
      .from('google_calendar_config')
      .upsert(row, { onConflict: 'account_id' })
    if (upsertError) {
      console.error('[google-calendar oauth callback] upsert failed:', upsertError)
      return NextResponse.redirect(settingsUrl('&error=save_failed'))
    }

    return NextResponse.redirect(settingsUrl('&connected=1'))
  } catch (err) {
    const message = err instanceof GoogleCalendarError ? err.message : 'unknown_error'
    console.error('[google-calendar oauth callback] failed:', err)
    return NextResponse.redirect(settingsUrl(`&error=${encodeURIComponent(message)}`))
  }
}
