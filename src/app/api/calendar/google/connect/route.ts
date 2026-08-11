import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getBaseUrl } from '@/lib/http/base-url';
import {
  createGoogleOAuth2Client,
  googleCallbackUrl,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_OAUTH_STATE_COOKIE,
} from '@/lib/calendar/google-oauth-client';

/**
 * GET /api/calendar/google/connect
 *
 * Starts the OAuth flow: any signed-in agent can connect their own
 * Google Calendar (no minimum role — this is a personal credential,
 * not an account-wide setting). Redirects the browser straight to
 * Google's consent screen; the `agenda-week.tsx` "Conectar Google
 * Calendar" button links here directly (full navigation, not fetch).
 */
export async function GET(request: Request) {
  try {
    await getCurrentAccount(); // throws 401/403 if not signed in / no account

    const baseUrl = getBaseUrl(request);
    const redirectUri = googleCallbackUrl(baseUrl);
    const oauth2Client = createGoogleOAuth2Client(redirectUri);

    // Random CSRF state, echoed back by Google and checked against
    // this same cookie in the callback.
    const state = crypto.randomBytes(24).toString('hex');

    const authUrl = oauth2Client.generateAuthUrl({
      // offline + consent (not just the default 'select_account')
      // together are what guarantee Google actually issues a
      // refresh_token — without `prompt=consent`, a user who
      // previously granted access gets no refresh_token on a repeat
      // consent, which would silently break sync once the short-lived
      // access token expires.
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_CALENDAR_SCOPES,
      state,
    });

    const response = NextResponse.redirect(authUrl);
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes — plenty for a consent screen, short enough to limit replay
      path: '/api/calendar/google',
    });
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
