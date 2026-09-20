import { existsSync, readFileSync } from 'fs'
import { createSign } from 'crypto'
import { CalendarError } from './client'
import type { HttpClient } from './client'

// ============================================================
// Bloco 3-A — Google Service Account (domain-wide delegation) auth.
//
// Distinct from the per-account OAuth flow in client.ts/env.ts/
// account-client.ts (that one is "each wacrm account connects its OWN
// Google Calendar via a consent screen"). This one is a single,
// deployment-wide service account impersonating one fixed Workspace
// user (geral@etergrowth.com) to read/write the commercial-mode leads
// calendar — same pattern as the "Gestor - Eter Growth" repo's
// reference script (tools/google-calendar/setup-leads-calendar.ts):
// a JWT-bearer assertion signed with the service account's private
// key, with a `sub` claim for impersonation.
//
// Deliberately implemented WITHOUT adding a new dependency: this
// repo's Calendar client (client.ts) documents a "no googleapis
// dependency" policy, so this signs the JWT-bearer assertion by hand
// with Node's built-in `crypto` (RS256) and exchanges it with a plain
// `fetch`, mirroring the rest of client.ts's style (injectable
// HttpClient, so tests never hit the network).
//
// Credentials come ONLY from the environment, never from a DB column
// or the codebase (see CLAUDE.md's secrets rule):
// `GOOGLE_SERVICE_ACCOUNT_JSON` is either the raw JSON key content or a
// filesystem path to it; `GMAIL_IMPERSONATE_USER` is the Workspace user
// to impersonate (defaults to geral@etergrowth.com, matching the
// Gestor script's own default).
// ============================================================

export interface ServiceAccountKey {
  clientEmail: string
  privateKey: string
}

interface RawServiceAccountKey {
  client_email?: string
  private_key?: string
}

/**
 * Load the service account key from `GOOGLE_SERVICE_ACCOUNT_JSON`.
 * Accepts either the raw JSON text (common on serverless platforms
 * where secrets are env strings, not files) or a filesystem path to the
 * key file (matches the Gestor script, convenient for local dev).
 * Throws loudly — never returns a partial/invalid key — so a
 * misconfiguration fails at the first call that needs it.
 */
export function loadServiceAccountFromEnv(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw || !raw.trim()) {
    throw new CalendarError(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not configured — set it to the service-account JSON (or a path to it) to enable Bloco 3-A commercial scheduling.',
      { code: 'missing_service_account', status: 500 },
    )
  }

  const trimmed = raw.trim()
  let jsonText: string
  if (trimmed.startsWith('{')) {
    jsonText = trimmed
  } else {
    if (!existsSync(trimmed)) {
      throw new CalendarError(
        `GOOGLE_SERVICE_ACCOUNT_JSON does not point to a JSON string nor an existing file: ${trimmed}`,
        { code: 'missing_service_account', status: 500 },
      )
    }
    jsonText = readFileSync(trimmed, 'utf-8')
  }

  let parsed: RawServiceAccountKey
  try {
    parsed = JSON.parse(jsonText) as RawServiceAccountKey
  } catch {
    throw new CalendarError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.', {
      code: 'missing_service_account',
      status: 500,
    })
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new CalendarError(
      'GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.',
      { code: 'missing_service_account', status: 500 },
    )
  }

  return { clientEmail: parsed.client_email, privateKey: parsed.private_key }
}

/** The Workspace user the service account impersonates. Defaults to
 *  geral@etergrowth.com — the account that owns both the commercial
 *  leads calendar and the "primary" calendar Bloco 3-A checks for
 *  cross-availability, matching the Gestor repo's own default. */
export function commercialImpersonatedUserFromEnv(): string {
  const user = process.env.GMAIL_IMPERSONATE_USER
  return user && user.trim() ? user.trim() : 'geral@etergrowth.com'
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const JWT_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
/** Google access tokens are valid ~1h; refresh a little early. */
const TOKEN_TTL_SEC = 3600
const TOKEN_REFRESH_SKEW_SEC = 60

const defaultHttp: HttpClient = { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) }

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input
  return buf.toString('base64url')
}

/** Build and sign the JWT-bearer assertion Google's token endpoint
 *  expects for a service-account exchange (RFC 7523), including the
 *  `sub` claim that makes this a domain-wide-delegation impersonation
 *  rather than the service account acting as itself. */
function buildSignedAssertion(sa: ServiceAccountKey, scope: string, subject: string): string {
  const nowSec = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.clientEmail,
    scope,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + TOKEN_TTL_SEC,
    sub: subject,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.privateKey)
  return `${unsigned}.${base64url(signature)}`
}

interface CachedToken {
  accessToken: string
  expiresAtSec: number
}

// Module-level cache so repeated tool calls within the same (or nearby)
// conversation turns don't each pay a token-exchange round trip — keyed
// by subject+scope since, in principle, a future caller could ask for a
// different scope or impersonate a different user. Safe across
// concurrent requests on the same process: worst case a few callers
// each fetch their own fresh token before the first one lands in the
// cache, which just means one or two extra token exchanges, never a
// correctness issue.
const tokenCache = new Map<string, CachedToken>()

/**
 * Exchange the service account's signed assertion for an access token,
 * impersonating `opts.subject` with `opts.scope`. Cached in-memory for
 * the remainder of the token's lifetime (minus a safety skew).
 */
export async function getServiceAccountAccessToken(
  sa: ServiceAccountKey,
  opts: { scope: string; subject: string },
  http: HttpClient = defaultHttp,
): Promise<string> {
  const cacheKey = `${sa.clientEmail}::${opts.subject}::${opts.scope}`
  const cached = tokenCache.get(cacheKey)
  const nowSec = Math.floor(Date.now() / 1000)
  if (cached && cached.expiresAtSec - TOKEN_REFRESH_SKEW_SEC > nowSec) {
    return cached.accessToken
  }

  const assertion = buildSignedAssertion(sa, opts.scope, opts.subject)

  let res: Response
  try {
    res = await http.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_GRANT_TYPE, assertion }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CalendarError(`Could not reach Google's token endpoint: ${msg}`, {
      code: 'network_error',
      status: 502,
    })
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    const isGrantIssue = /invalid_grant|unauthorized_client/i.test(bodyText)
    throw new CalendarError(
      isGrantIssue
        ? `Google service-account authorization failed — check that domain-wide delegation for this client id includes the calendar scope and that it is authorized to impersonate ${opts.subject}. (${bodyText})`
        : `Google service-account token exchange failed (HTTP ${res.status}): ${bodyText}`,
      { code: isGrantIssue ? 'invalid_grant' : 'google_error', status: res.status >= 500 ? 502 : res.status },
    )
  }

  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
  if (!data?.access_token) {
    throw new CalendarError('Google service-account token exchange returned no access_token.', {
      code: 'invalid_token_response',
    })
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : TOKEN_TTL_SEC
  tokenCache.set(cacheKey, { accessToken: data.access_token, expiresAtSec: nowSec + expiresIn })
  return data.access_token
}

/** Test-only escape hatch — clears the module-level token cache so
 *  each test starts from a clean slate. */
export function __resetServiceAccountTokenCacheForTests(): void {
  tokenCache.clear()
}
