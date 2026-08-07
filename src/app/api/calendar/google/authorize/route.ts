import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { buildGoogleAuthorizeUrl, googleOAuthCredentialsFromEnv } from '@/lib/calendar/google/client'
import { signOAuthState } from '@/lib/calendar/google/oauth-state'
import { googleOAuthStateSecretFromEnv, googleOAuthRedirectUriFromEnv } from '@/lib/calendar/google/env'
import { oauthRouteErrorResponse } from '@/lib/calendar/google/route-errors'

// ============================================================
// GET /api/calendar/google/authorize
//
// Starts the "Connect Google Calendar" flow: mints a signed `state`
// bound to the caller's account, then 302s to Google's consent
// screen. Admin-only — connecting a calendar is a workspace-wide
// credential change, same bar as `canEditSettings` gates elsewhere
// (WhatsApp config, AI config).
//
// No request body/params are trusted from the client beyond the
// authenticated session — `accountId` comes from `requireRole`, never
// from a query string, so this can't be used to attach a Google
// connection to an account the caller doesn't belong to.
// ============================================================

export async function GET() {
  try {
    const { accountId, userId } = await requireRole('admin')

    const creds = googleOAuthCredentialsFromEnv()
    const stateSecret = googleOAuthStateSecretFromEnv()
    const redirectUri = googleOAuthRedirectUriFromEnv()

    const state = signOAuthState(accountId, stateSecret)

    const url = buildGoogleAuthorizeUrl({
      clientId: creds.clientId,
      redirectUri,
      state,
    })

    // Not used for correctness (state already binds accountId), just
    // a diagnostic breadcrumb if a support ticket needs "who started
    // this connection attempt".
    console.info(`[calendar/google/authorize] account=${accountId} user=${userId} → redirecting to Google`)

    return NextResponse.redirect(url)
  } catch (err) {
    return oauthRouteErrorResponse(err)
  }
}
