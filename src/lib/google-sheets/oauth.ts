import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from './admin-client'
import { dispatchSystemAlert, resolveSystemAlert } from '@/lib/observability/alerts'

// ============================================================
// Google Sheets OAuth — Authorization Code flow with
// `access_type=offline` for a refresh_token. Structurally identical to
// src/lib/google-calendar/oauth.ts (which see for the design notes on
// why `prompt=consent`, the 60s refresh slack, the disconnect alert,
// etc.); only the scopes, env-var names, table name and the
// notification copy differ.
//
// Scope: `spreadsheets` lets the app read/append to any sheet the
// connected Google account can reach — needed because the operator
// picks the target spreadsheet by id/URL, not via Google's file
// Picker. It sits in Google's "sensitive" tier: fine under the
// 100-test-user cap, needs app verification beyond that (same
// trade-off already accepted for Calendar). `drive.file` would avoid
// verification but forces a Picker-based file selection UI.
// ============================================================

export const OAUTH_STATE_COOKIE = 'gsheets_oauth_state'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
]

export class GoogleSheetsError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message)
    this.name = 'GoogleSheetsError'
  }
}

const GOOGLE_API_TIMEOUT_MS = 20_000

export async function googleFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new GoogleSheetsError('Google API request timed out.', 504)
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new GoogleSheetsError(`Could not reach Google: ${message}`, 502)
  }
}

function clientId(): string {
  const id = process.env.GOOGLE_SHEETS_CLIENT_ID
  if (!id) throw new GoogleSheetsError('GOOGLE_SHEETS_CLIENT_ID is not configured.', 503)
  return id
}

function clientSecret(): string {
  const secret = process.env.GOOGLE_SHEETS_CLIENT_SECRET
  if (!secret) throw new GoogleSheetsError('GOOGLE_SHEETS_CLIENT_SECRET is not configured.', 503)
  return secret
}

/** Must exactly match an "Authorized redirect URI" on the Google Cloud
 *  OAuth client. Can be a different client from Calendar's, or the same
 *  one with this URI + the Sheets scope added. */
export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (!base) throw new GoogleSheetsError('NEXT_PUBLIC_SITE_URL is not configured.', 503)
  return `${base}/api/google-sheets/oauth/callback`
}

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
    throw new GoogleSheetsError(`Google rejected the authorization code: ${body}`, 502)
  }
  return (await res.json()) as TokenResponse
}

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
    throw new GoogleSheetsError(`Google rejected the refresh token: ${body}`, 502)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  const expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000)
  return { accessToken: data.access_token, expiresAt }
}

async function notifyGoogleSheetsDisconnected(accountId: string, message: string): Promise<void> {
  try {
    const db = supabaseAdmin()

    await db
      .from('google_sheets_config')
      .update({ status: 'disconnected', last_connection_error: message })
      .eq('account_id', accountId)

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    const { data: recent } = await db
      .from('notifications')
      .select('id')
      .eq('account_id', accountId)
      .eq('type', 'google_sheets_error')
      .gte('created_at', sixHoursAgo)
      .limit(1)
      .maybeSingle()
    if (recent) return

    const { data: recipients } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .in('account_role', ['owner', 'admin'])
    if (!recipients || recipients.length === 0) return

    await db.from('notifications').insert(
      recipients.map((r) => ({
        account_id: accountId,
        user_id: r.user_id as string,
        type: 'google_sheets_error',
        title: 'Google Sheets se desconectó',
        body: 'El CRM ya no puede escribir en tu Google Sheet — Google rechazó el token de acceso. Reconectá desde Configuración → Google Sheets.',
      })),
    )

    await dispatchSystemAlert({
      severity: 'warning',
      source: 'google_sheets',
      title: 'Google Sheets disconnected for an account',
      detail: { account_id: accountId, message },
      dedupKey: `google_sheets:${accountId}`,
      accountId,
      throttleMinutes: 360,
    })
  } catch (err) {
    console.error('[google-sheets] failed to send disconnect notification:', err)
  }
}

interface SheetsConfigRow {
  refresh_token: string
  access_token: string | null
  token_expiry: string | null
}

/**
 * Plaintext access token guaranteed valid for immediate use against
 * the Sheets API — refreshes + persists (encrypted) if the stored one
 * is missing or within 60s of expiry. Mirrors
 * google-calendar/oauth.ts's getValidAccessToken.
 */
export async function getValidAccessToken(db: SupabaseClient, accountId: string): Promise<string> {
  const { data: config, error } = await db
    .from('google_sheets_config')
    .select('refresh_token, access_token, token_expiry')
    .eq('account_id', accountId)
    .maybeSingle<SheetsConfigRow>()
  if (error) throw new GoogleSheetsError(error.message, 500)
  if (!config) throw new GoogleSheetsError('Google Sheets is not connected for this account.', 400)

  const notExpired = config.token_expiry && new Date(config.token_expiry) > new Date()
  if (config.access_token && notExpired) {
    try {
      return decrypt(config.access_token)
    } catch (err) {
      console.error('[google-sheets] cached access_token decrypt failed, refreshing:', err)
    }
  }

  let refreshToken: string
  try {
    refreshToken = decrypt(config.refresh_token)
  } catch (err) {
    console.error('[google-sheets] refresh_token decrypt failed:', err)
    const message = 'Stored Google Sheets credentials cannot be decrypted — reconnect from Settings.'
    void notifyGoogleSheetsDisconnected(accountId, message)
    throw new GoogleSheetsError(message, 400)
  }

  let accessToken: string
  let expiresAt: Date
  try {
    ;({ accessToken, expiresAt } = await refreshAccessToken(refreshToken))
  } catch (err) {
    if (err instanceof GoogleSheetsError && err.message.startsWith('Google rejected the refresh token')) {
      void notifyGoogleSheetsDisconnected(accountId, err.message)
    }
    throw err
  }

  const { error: updateError } = await db
    .from('google_sheets_config')
    .update({ access_token: encrypt(accessToken), token_expiry: expiresAt.toISOString() })
    .eq('account_id', accountId)
  if (updateError) {
    console.error('[google-sheets] failed to persist refreshed access_token:', updateError)
  }

  void resolveSystemAlert(`google_sheets:${accountId}`)

  return accessToken
}
