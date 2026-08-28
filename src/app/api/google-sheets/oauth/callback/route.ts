import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireRole } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { resolveBaseUrl } from '@/lib/http/base-url'
import {
  exchangeCodeForTokens,
  fetchConnectedEmail,
  GoogleSheetsError,
  OAUTH_STATE_COOKIE,
} from '@/lib/google-sheets/oauth'

/**
 * GET /api/google-sheets/oauth/callback
 *
 * Mirror of src/app/api/google-calendar/oauth/callback — validate
 * `state` against the cookie, exchange the code, store the encrypted
 * tokens, redirect back to Settings. The spreadsheet is picked
 * separately afterwards (PUT /api/google-sheets/config), so a fresh
 * connection lands with status='connected' but spreadsheet_id=null.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const base = resolveBaseUrl(request)
  const settingsUrl = (params: string) => `${base}/settings?tab=google-sheets${params}`

  const error = url.searchParams.get('error')
  if (error) {
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
      return NextResponse.redirect(settingsUrl('&error=no_refresh_token'))
    }
    const email = await fetchConnectedEmail(tokens.access_token)

    const row = {
      user_id: userId,
      account_id: accountId,
      refresh_token: encrypt(tokens.refresh_token),
      access_token: encrypt(tokens.access_token),
      token_expiry: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
      google_email: email,
      status: 'connected' as const,
      connected_at: new Date().toISOString(),
      last_connection_error: null,
    }

    const { error: upsertError } = await supabase
      .from('google_sheets_config')
      .upsert(row, { onConflict: 'account_id' })
    if (upsertError) {
      console.error('[google-sheets oauth callback] upsert failed:', upsertError)
      return NextResponse.redirect(settingsUrl('&error=save_failed'))
    }

    return NextResponse.redirect(settingsUrl('&connected=1'))
  } catch (err) {
    const message = err instanceof GoogleSheetsError ? err.message : 'unknown_error'
    console.error('[google-sheets oauth callback] failed:', err)
    return NextResponse.redirect(settingsUrl(`&error=${encodeURIComponent(message)}`))
  }
}
