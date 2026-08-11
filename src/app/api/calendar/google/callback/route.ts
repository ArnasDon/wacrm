import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getCurrentAccount } from '@/lib/auth/account';
import { getBaseUrl } from '@/lib/http/base-url';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  createGoogleOAuth2Client,
  googleCallbackUrl,
  GOOGLE_OAUTH_STATE_COOKIE,
} from '@/lib/calendar/google-oauth-client';

/**
 * GET /api/calendar/google/callback
 *
 * Google redirects here after consent. Exchanges the authorization
 * code for tokens, resolves the connected Google account's email,
 * and upserts one row into `calendar_connections` for the current
 * wacrm user. Always redirects back to the dashboard — success or
 * failure — with a `calendar=` query param the UI can toast on.
 */
export async function GET(request: Request) {
  const baseUrl = getBaseUrl(request);
  const dashboardUrl = (status: 'connected' | 'error') =>
    `${baseUrl}/dashboard?calendar=${status}`;

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${GOOGLE_OAUTH_STATE_COOKIE}=`))
    ?.slice(GOOGLE_OAUTH_STATE_COOKIE.length + 1);

  // Always clear the state cookie once we've read it, regardless of
  // outcome — it's single-use.
  const clearStateCookie = (response: NextResponse) => {
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/api/calendar/google',
    });
    return response;
  };

  if (!code || !state || !stateCookie || state !== stateCookie) {
    // Missing/mismatched state means either a stale link, a replayed
    // callback, or an attempted login-CSRF — reject rather than guess.
    console.error('[calendar/google/callback] state mismatch or missing code');
    return clearStateCookie(NextResponse.redirect(dashboardUrl('error')));
  }

  try {
    const { userId, accountId, supabase } = await getCurrentAccount();

    const redirectUri = googleCallbackUrl(baseUrl);
    const oauth2Client = createGoogleOAuth2Client(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
      // No refresh_token typically means the consent screen was
      // shown without `prompt=consent` reaching Google (e.g. a
      // stale cached auth URL) — the /connect route always sets it,
      // so this should be rare. Surface as a connect failure rather
      // than silently storing an unrefreshable connection.
      console.error('[calendar/google/callback] incomplete token response', {
        hasAccessToken: Boolean(tokens.access_token),
        hasRefreshToken: Boolean(tokens.refresh_token),
      });
      return clearStateCookie(NextResponse.redirect(dashboardUrl('error')));
    }

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();
    const googleEmail = userinfo.email;
    if (!googleEmail) {
      console.error('[calendar/google/callback] Google returned no email in userinfo');
      return clearStateCookie(NextResponse.redirect(dashboardUrl('error')));
    }

    const { error } = await supabase.from('calendar_connections').upsert(
      {
        account_id: accountId,
        user_id: userId,
        provider: 'google_calendar',
        google_email: googleEmail,
        access_token_encrypted: encrypt(tokens.access_token),
        refresh_token_encrypted: encrypt(tokens.refresh_token),
        token_expires_at: new Date(tokens.expiry_date).toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      console.error('[calendar/google/callback] failed to store connection:', error);
      return clearStateCookie(NextResponse.redirect(dashboardUrl('error')));
    }

    return clearStateCookie(NextResponse.redirect(dashboardUrl('connected')));
  } catch (err) {
    console.error('[calendar/google/callback] unexpected error:', err);
    return clearStateCookie(NextResponse.redirect(dashboardUrl('error')));
  }
}
