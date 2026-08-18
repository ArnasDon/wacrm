import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

// ============================================================
// Google Calendar OAuth (Authorization Code flow, `access_type=offline`
// for a refresh_token). First real OAuth redirect-and-callback
// integration in this project — every other channel (WhatsApp,
// Instagram, Facebook) uses a manually-pasted, long-lived token. Google
// access tokens expire in ~1h, so this also introduces the project's
// first refresh-before-use pattern (`getValidAccessToken`).
// ============================================================

/** Shared between oauth/start and oauth/callback — kept out of the
 *  route files themselves since Next.js only allows a fixed set of
 *  named exports (GET, POST, etc.) from a route.ts file. */
export const OAUTH_STATE_COOKIE = 'gcal_oauth_state'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

// Deliberately narrow: calendar.events (create/read events) +
// calendar.freebusy (availability only, can't read event details) +
// userinfo.email (show which Google account is connected in Settings).
// All three sit in Google's "sensitive" verification tier, not
// "restricted" — the full `calendar` scope would pull in a heavier
// CASA security-assessment requirement once this account moves past
// Google's 100-test-user cap, which isn't needed for what this feature
// actually does.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/userinfo.email',
]

export class GoogleCalendarError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message)
    this.name = 'GoogleCalendarError'
  }
}

// No call to Google here (or in api.ts, which imports this) previously
// carried a timeout — the same gap already found and fixed in the
// WhatsApp/Instagram/Zernio API clients. A slow/unresponsive Google
// endpoint would hang until the reverse proxy in front of the app
// (EasyPanel, in production) gave up first and returned its own bare
// 502, before this module's own GoogleCalendarError ever got thrown.
const GOOGLE_API_TIMEOUT_MS = 20_000

/** `fetch` to Google's OAuth/Calendar APIs, bounded by
 *  `GOOGLE_API_TIMEOUT_MS` — every call site in this file and
 *  `google-calendar/api.ts` uses this instead of the bare global
 *  `fetch`. */
export async function googleFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new GoogleCalendarError('Google API request timed out.', 504)
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new GoogleCalendarError(`Could not reach Google: ${message}`, 502)
  }
}

function clientId(): string {
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID
  if (!id) throw new GoogleCalendarError('GOOGLE_CALENDAR_CLIENT_ID is not configured.', 503)
  return id
}

function clientSecret(): string {
  const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  if (!secret) throw new GoogleCalendarError('GOOGLE_CALENDAR_CLIENT_SECRET is not configured.', 503)
  return secret
}

/** Must exactly match an "Authorized redirect URI" configured on the
 *  Google Cloud OAuth client, or Google rejects the whole flow. */
export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (!base) throw new GoogleCalendarError('NEXT_PUBLIC_SITE_URL is not configured.', 503)
  return `${base}/api/google-calendar/oauth/callback`
}

/** The URL to send the browser to. `state` is an opaque anti-CSRF
 *  nonce the caller generates and verifies on callback (see
 *  src/app/api/google-calendar/oauth/start/route.ts) — it carries no
 *  account/user info itself; the callback re-derives those from the
 *  caller's still-active session cookie, the same browser round trip.
 *  `prompt=consent` forces Google to reissue a refresh_token even on a
 *  reconnect (Google only returns one on a account's very first
 *  authorization otherwise, which would silently break "disconnect,
 *  then reconnect"). */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES.join(' '),
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

/** Exchanges the one-time `code` Google appended to the callback URL
 *  for tokens. `refresh_token` is only present when Google actually
 *  issued one (first consent, or `prompt=consent` — see above). */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await googleFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleCalendarError(`Google rejected the authorization code: ${body}`, 502)
  }
  return (await res.json()) as TokenResponse
}

/** Fetches the connected account's email — display-only, shown in
 *  Settings so it's clear which Google account is wired up. Never
 *  throws; a failure here shouldn't block the connection itself. */
export async function fetchConnectedEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await googleFetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { email?: string }
    return data.email ?? null
  } catch {
    return null
  }
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await googleFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleCalendarError(`Google rejected the refresh token: ${body}`, 502)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  // Refresh a little early (60s slack) so a token that's valid when
  // fetched doesn't expire mid-request against the Calendar API.
  const expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000)
  return { accessToken: data.access_token, expiresAt }
}

interface CalendarConfigRow {
  refresh_token: string
  access_token: string | null
  token_expiry: string | null
}

/**
 * Returns a plaintext access token guaranteed valid for immediate use
 * against the Calendar API — refreshing (and persisting the refreshed
 * token, encrypted) if the stored one is missing or within 60s of
 * expiry. Every Calendar API call in src/lib/google-calendar/api.ts
 * goes through this first; no other call site should read
 * `google_calendar_config.access_token` directly.
 */
export async function getValidAccessToken(db: SupabaseClient, accountId: string): Promise<string> {
  const { data: config, error } = await db
    .from('google_calendar_config')
    .select('refresh_token, access_token, token_expiry')
    .eq('account_id', accountId)
    .maybeSingle<CalendarConfigRow>()
  if (error) throw new GoogleCalendarError(error.message, 500)
  if (!config) throw new GoogleCalendarError('Google Calendar is not connected for this account.', 400)

  const notExpired = config.token_expiry && new Date(config.token_expiry) > new Date()
  if (config.access_token && notExpired) {
    try {
      return decrypt(config.access_token)
    } catch (err) {
      console.error('[google-calendar] cached access_token decrypt failed, refreshing:', err)
      // Fall through to a refresh rather than failing outright — a
      // corrupted cached access_token doesn't mean the refresh_token
      // (checked next) is also bad.
    }
  }

  let refreshToken: string
  try {
    refreshToken = decrypt(config.refresh_token)
  } catch (err) {
    console.error('[google-calendar] refresh_token decrypt failed:', err)
    throw new GoogleCalendarError(
      'Stored Google Calendar credentials cannot be decrypted — reconnect from Settings.',
      400,
    )
  }

  const { accessToken, expiresAt } = await refreshAccessToken(refreshToken)

  const { error: updateError } = await db
    .from('google_calendar_config')
    .update({ access_token: encrypt(accessToken), token_expiry: expiresAt.toISOString() })
    .eq('account_id', accountId)
  if (updateError) {
    // The fresh token still works for this call even if the cache
    // write failed — log loudly (next call just refreshes again) but
    // don't fail the caller over a non-critical write.
    console.error('[google-calendar] failed to persist refreshed access_token:', updateError)
  }

  return accessToken
}
