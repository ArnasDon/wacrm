import { google } from 'googleapis';

/**
 * Shared Google OAuth wiring — used by the connect/callback routes
 * and by GoogleCalendarProvider's token-refresh path. Centralised so
 * the client id/secret env lookup and the scope list only live in
 * one place.
 */

// calendar.events (not the broader `calendar` scope) is enough to
// create/update/delete events on the user's calendars — no need to
// also read/write calendar *settings*. userinfo.email is added
// purely so the callback can show "Conectado como x@gmail.com" in
// the UI (calendar_connections.google_email) — it grants no extra
// calendar access.
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Short-lived, httpOnly — holds the CSRF `state` value between the
// /connect redirect and the /callback verification. Never read by
// client JS.
export const GOOGLE_OAUTH_STATE_COOKIE = 'gcal_oauth_state';

export function googleCallbackUrl(baseUrl: string): string {
  return `${baseUrl}/api/calendar/google/callback`;
}

function requireEnv(name: 'GOOGLE_CALENDAR_CLIENT_ID' | 'GOOGLE_CALENDAR_CLIENT_SECRET'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Google Calendar sync requires GOOGLE_CALENDAR_CLIENT_ID and ` +
        'GOOGLE_CALENDAR_CLIENT_SECRET — see .env.local.example.',
    );
  }
  return value;
}

/**
 * Builds an OAuth2 client. `redirectUri` is only meaningful for the
 * authorization-code exchange (connect/callback); token refresh
 * (used by the provider) doesn't need it, so callers there may pass
 * an empty string.
 */
export function createGoogleOAuth2Client(redirectUri: string) {
  const clientId = requireEnv('GOOGLE_CALENDAR_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
