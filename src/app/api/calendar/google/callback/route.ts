import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { upsertCalendarConfig } from '@/lib/eter/repo/calendar-config.repo'
import { exchangeCodeForTokens, googleOAuthCredentialsFromEnv } from '@/lib/calendar/google/client'
import { verifyOAuthState, OAuthStateError } from '@/lib/calendar/google/oauth-state'
import { googleOAuthStateSecretFromEnv, googleOAuthRedirectUriFromEnv } from '@/lib/calendar/google/env'

// ============================================================
// GET /api/calendar/google/callback
//
// Google redirects here after the user grants (or denies) consent.
// Always resolves to a redirect back to the settings page — success
// or failure — carrying a `calendar` / `calendar_error` query param
// the settings UI reads to show a toast. Never throws a raw 500 back
// to the browser: every failure mode a user can hit (denied consent,
// expired link, no refresh token, Google API error) is a known,
// redirectable case.
//
// The connection lands INACTIVE (`isActive: false`) — the account
// still needs to pick a calendar id/timezone/business hours in the
// settings form and flip the switch before the agent will actually
// book meetings on it.
// ============================================================

const SETTINGS_PATH = '/settings?tab=calendar'

function redirectToSettings(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL(SETTINGS_PATH, request.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const googleError = url.searchParams.get('error')

  // The user clicked "Cancel" / "Deny" on Google's consent screen, or
  // Google itself rejected the request (e.g. bad client config). Not
  // a bug — surface it as a normal, expected outcome.
  if (googleError) {
    return redirectToSettings(request, { calendar_error: `google_${googleError}` })
  }

  if (!code || !state) {
    return redirectToSettings(request, { calendar_error: 'missing_params' })
  }

  // Verify the state BEFORE doing anything else — this is the
  // anti-CSRF / anti-forgery gate. A failure here (tampered,
  // expired, wrong secret) means we don't even know which account to
  // trust, so nothing downstream can proceed.
  let accountIdFromState: string
  try {
    const stateSecret = googleOAuthStateSecretFromEnv()
    const payload = verifyOAuthState(state, stateSecret)
    accountIdFromState = payload.accountId
  } catch (err) {
    const stateErrorCode = err instanceof OAuthStateError ? err.code : 'invalid_state'
    console.warn(`[calendar/google/callback] state verification failed: ${stateErrorCode}`)
    return redirectToSettings(request, { calendar_error: `state_${stateErrorCode}` })
  }

  // Require a live session AND that it belongs to the same account
  // the state was minted for. Defense in depth on top of the signed
  // state: guards against a connection link being replayed in a
  // different account's browser/session (e.g. a shared machine), and
  // against a session that expired mid-flow.
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch {
    return redirectToSettings(request, { calendar_error: 'session_expired' })
  }
  if (ctx.accountId !== accountIdFromState) {
    console.warn(
      `[calendar/google/callback] state account (${accountIdFromState}) does not match session account (${ctx.accountId}) — refusing to write.`,
    )
    return redirectToSettings(request, { calendar_error: 'account_mismatch' })
  }

  try {
    const creds = googleOAuthCredentialsFromEnv()
    const redirectUri = googleOAuthRedirectUriFromEnv()
    const tokens = await exchangeCodeForTokens(code, redirectUri, creds)

    // Google can omit refresh_token on re-consent even with
    // `prompt=consent` in some edge cases (e.g. the OAuth client was
    // just changed). Never upsert a null/empty token — that would
    // silently leave the account "connected" with nothing the agent
    // can actually use once the access token expires.
    if (!tokens.refreshToken) {
      console.error(
        `[calendar/google/callback] account=${ctx.accountId} — Google returned no refresh_token.`,
      )
      return redirectToSettings(request, { calendar_error: 'no_refresh_token' })
    }

    await upsertCalendarConfig(ctx.supabase, ctx.accountId, {
      refreshToken: tokens.refreshToken,
      calendarId: 'primary',
      timezone: 'Europe/Lisbon',
      isActive: false,
    })

    return redirectToSettings(request, { calendar: 'connected' })
  } catch (err) {
    console.error('[calendar/google/callback] token exchange / save failed:', err)
    return redirectToSettings(request, { calendar_error: 'exchange_failed' })
  }
}
