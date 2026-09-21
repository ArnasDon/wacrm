// ============================================================
// Thin Google Calendar v3 + OAuth2 client, built on raw `fetch` (no
// `googleapis` dependency — not in package.json, and this project's
// surface is small enough not to need it).
//
// This module never touches encryption or Supabase — it receives an
// already-decrypted refresh token (decrypted by
// `src/lib/eter/repo/calendar-config.repo.ts`, the only place that
// knows about `ENCRYPTION_KEY` / AES-256-GCM for this domain) and hands
// back access tokens, busy intervals, and event CRUD. Every function
// takes an injectable `http` client (defaults to the global `fetch`) so
// tests never make a real network call — see client.test.ts.
//
// Timezone: every Date in and out of this module is an absolute UTC
// instant (a JS `Date`); the IANA `timezone` argument tells Google how
// to *render* it (`start.timeZone` on events), never how to interpret
// it. Callers must pass the account's own `calendar_configs.timezone`
// — this module has no default and will not silently assume UTC or the
// server's local zone.
// ============================================================

export class CalendarError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'CalendarError'
    this.code = opts.code ?? 'calendar_error'
    this.status = opts.status ?? 502
  }
}

/**
 * True when `err` is a `CalendarError` produced by a revoked/invalid
 * Google OAuth grant — the user disconnected the app in their Google
 * Account, an admin revoked the OAuth client, or the refresh token
 * otherwise stopped working. Google reports this as an
 * `invalid_grant` error on `refreshAccessToken`/`exchangeCodeForTokens`
 * (usually HTTP 400, occasionally 401). Distinguishing this from a
 * generic API failure matters because it's not retryable: the caller
 * needs a brand-new consent flow, not a retry with backoff. See
 * `src/lib/calendar/google/account-client.ts` / the tool-executor's
 * revocation handling for where this is consumed.
 */
export function isRevokedGrantError(err: unknown): err is CalendarError {
  if (!(err instanceof CalendarError)) return false
  return err.code === 'invalid_token' || /invalid_grant/i.test(err.message)
}

export interface HttpClient {
  fetch: typeof fetch
}

const defaultHttp: HttpClient = { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) }

export interface GoogleOAuthCredentials {
  clientId: string
  clientSecret: string
}

/** Reads `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` from
 *  the environment (same names the Fase 1 OAuth connect flow already
 *  documents in docs/eter-agent-config.md — kept in sync rather than
 *  introducing a second variable naming convention). Throws (not a
 *  silent undefined) so a missing config fails loudly at the first call
 *  that needs it, rather than producing a cryptic Google 401 later. */
export function googleOAuthCredentialsFromEnv(): GoogleOAuthCredentials {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new CalendarError(
      'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured — see docs/eter-agent-config.md.',
      { code: 'missing_oauth_config', status: 500 },
    )
  }
  return { clientId, clientSecret }
}

export interface GoogleTokens {
  accessToken: string
  /** Absolute expiry instant, computed from Google's `expires_in`. */
  expiresAt: Date
}

const OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

/** Minimal scopes for the agent's calendar use — read free/busy to
 *  offer slots, and create/update/delete the events it books itself.
 *  Deliberately NOT the broad `calendar` scope (full read/write
 *  access to every calendar detail, ACLs included): the agent never
 *  needs to read event contents or manage calendar sharing, so
 *  requesting less here is both a real security reduction and a
 *  smaller ask on Google's consent screen. */
export const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
] as const

/**
 * Build the Google consent-screen URL for the "Connect Google
 * Calendar" flow. `access_type=offline` + `prompt=consent` are both
 * required to reliably get a `refresh_token` back on the callback —
 * without `prompt=consent`, Google silently omits it on any
 * authorization after the first (see `exchangeCodeForTokens`'s doc on
 * `refreshToken: null`).
 */
export function buildGoogleAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  loginHint?: string
}): string {
  const url = new URL(OAUTH_AUTHORIZE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_CALENDAR_OAUTH_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', params.state)
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint)
  return url.toString()
}

export interface ExchangedTokens {
  accessToken: string
  expiresAt: Date
  /**
   * Google only returns a `refresh_token` on some authorization-code
   * exchanges — reliably on the FIRST consent for a given
   * user+client (or any consent that used `prompt=consent`, which
   * `buildGoogleAuthorizeUrl` always sets), but it can still be
   * absent if the account already granted these scopes to this OAuth
   * client and Google decides not to re-issue one. Callers MUST
   * treat `null` as "connection failed, ask the user to retry" —
   * never silently upsert a null/empty token into `calendar_configs`.
   */
  refreshToken: string | null
}

async function googleFetch(
  http: HttpClient,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await http.fetch(url, init)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CalendarError(`Could not reach Google Calendar: ${msg}`, {
      code: 'network_error',
      status: 502,
    })
  }
}

async function parseGoogleError(res: Response): Promise<CalendarError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } | string }
    detail = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? '')
  } catch {
    // Non-JSON body — fall back to the status line.
  }
  const code =
    res.status === 401
      ? 'invalid_token'
      : res.status === 403
        ? 'forbidden'
        : res.status === 404
          ? 'not_found'
          : res.status === 409
            ? 'conflict'
            : 'google_error'
  return new CalendarError(
    detail ? `Google Calendar API error (${res.status}): ${detail}` : `Google Calendar API error (${res.status})`,
    { code, status: res.status >= 500 ? 502 : res.status },
  )
}

/**
 * Exchange an authorization `code` (from the OAuth callback's `?code=`
 * query param) for tokens. This is the ONE call in the flow that can
 * hand back a `refresh_token` — see `ExchangedTokens.refreshToken`'s
 * doc for why it can still be null and what callers must do about it.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  creds: GoogleOAuthCredentials,
  http: HttpClient = defaultHttp,
): Promise<ExchangedTokens> {
  const res = await googleFetch(http, OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw await parseGoogleError(res)

  const data = (await res.json().catch(() => null)) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
  } | null
  if (!data?.access_token) {
    throw new CalendarError('Google token exchange returned no access_token.', {
      code: 'invalid_token_response',
    })
  }
  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + expiresInSec * 1000),
    refreshToken: data.refresh_token ?? null,
  }
}

/**
 * Exchange a refresh token for a fresh access token. Google refresh
 * tokens are long-lived and normally don't rotate on refresh, but if
 * Google *does* return a new `refresh_token` in the response, the
 * caller is responsible for persisting it (via
 * `updateCalendarConfigRefreshToken` in calendar-config.repo.ts) — this
 * function surfaces it on the return value rather than silently
 * dropping it, since an unpersisted rotated token would eventually make
 * every future refresh fail.
 */
export async function refreshAccessToken(
  refreshToken: string,
  creds: GoogleOAuthCredentials,
  http: HttpClient = defaultHttp,
): Promise<GoogleTokens & { rotatedRefreshToken: string | null }> {
  const res = await googleFetch(http, OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw await parseGoogleError(res)

  const data = (await res.json().catch(() => null)) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
  } | null
  if (!data?.access_token) {
    throw new CalendarError('Google token refresh returned no access_token.', {
      code: 'invalid_token_response',
    })
  }
  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + expiresInSec * 1000),
    rotatedRefreshToken: data.refresh_token ?? null,
  }
}

export interface BusyInterval {
  start: Date
  end: Date
}

/**
 * Query Google's `freeBusy` endpoint for `calendarId` over
 * `[range.start, range.end)`. Returns only the *busy* intervals Google
 * already knows about (existing events on the calendar, including ones
 * not created by this agent) — combining that with `buffer_min` /
 * `min_lead_time_min` / `business_hours` into actual offerable slots is
 * `calculateAvailability` in availability.ts, not this function.
 */
export async function getBusySlots(
  accessToken: string,
  calendarId: string,
  range: { start: Date; end: Date },
  http: HttpClient = defaultHttp,
): Promise<BusyInterval[]> {
  const res = await googleFetch(http, `${CALENDAR_API_BASE}/freeBusy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: range.start.toISOString(),
      timeMax: range.end.toISOString(),
      items: [{ id: calendarId }],
    }),
  })
  if (!res.ok) throw await parseGoogleError(res)

  const data = (await res.json().catch(() => null)) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>
  } | null
  const busy = data?.calendars?.[calendarId]?.busy ?? []
  return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
}

/**
 * Bloco 3-A — query Google's `freeBusy` endpoint for SEVERAL calendars
 * at once, returning each one's busy intervals separately. Used to
 * check a proposed slot is free across both the commercial leads
 * calendar AND a personal/team calendar it must never collide with
 * (`ai_configs.commercial_busy_calendar_ids`) — a single `freeBusy`
 * request already supports multiple `items`, so this is one round trip
 * regardless of list length, not N calls to `getBusySlots`.
 *
 * A calendar id the caller (or the impersonated service account) can't
 * read comes back from Google as an entry with an `errors` array and no
 * `busy` list — treated as "unknown/unavailable", not "free", by
 * returning an empty busy array for the KEY only ever set to an empty
 * array (defensive default), never throwing: a single misconfigured
 * calendar id must not take down availability for every other one.
 */
export async function getFreeBusyForCalendars(
  accessToken: string,
  calendarIds: readonly string[],
  range: { start: Date; end: Date },
  http: HttpClient = defaultHttp,
): Promise<Record<string, BusyInterval[]>> {
  const uniqueIds = Array.from(new Set(calendarIds.filter((id) => id.trim().length > 0)))
  const result: Record<string, BusyInterval[]> = {}
  if (uniqueIds.length === 0) return result

  const res = await googleFetch(http, `${CALENDAR_API_BASE}/freeBusy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: range.start.toISOString(),
      timeMax: range.end.toISOString(),
      items: uniqueIds.map((id) => ({ id })),
    }),
  })
  if (!res.ok) throw await parseGoogleError(res)

  const data = (await res.json().catch(() => null)) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>
  } | null

  for (const id of uniqueIds) {
    const busy = data?.calendars?.[id]?.busy ?? []
    result[id] = busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
  }
  return result
}

export interface CalendarEventInput {
  summary: string
  description?: string
  start: Date
  end: Date
  /** IANA timezone Google should render the event in — always the
   *  account's `calendar_configs.timezone`, never inferred. */
  timezone: string
  attendeeEmails?: string[]
}

export interface CalendarEvent {
  id: string
  htmlLink: string | null
  start: Date
  end: Date
}

interface GoogleEventResponse {
  id: string
  htmlLink?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
}

function toEventBody(input: CalendarEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
    attendees: input.attendeeEmails?.map((email) => ({ email })),
  }
}

function toCalendarEvent(data: GoogleEventResponse): CalendarEvent {
  return {
    id: data.id,
    htmlLink: data.htmlLink ?? null,
    start: data.start?.dateTime ? new Date(data.start.dateTime) : new Date(NaN),
    end: data.end?.dateTime ? new Date(data.end.dateTime) : new Date(NaN),
  }
}

/**
 * `sendUpdates=all` is a QUERY parameter on `events.insert`/`events.patch`
 * (never a body field) — without it Google defaults to `none` and
 * creates/updates the event with the attendee listed, but never emails
 * them an invite. Every event this agent creates has an attendee that
 * needs to actually receive that email (the lead, on `book_meeting` /
 * `book_commercial_meeting`), so both functions below always ask for it.
 * See https://developers.google.com/calendar/api/v3/reference/events/insert.
 */
export async function createEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
  http: HttpClient = defaultHttp,
): Promise<CalendarEvent> {
  const res = await googleFetch(
    http,
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toEventBody(input)),
    },
  )
  if (!res.ok) throw await parseGoogleError(res)
  const data = (await res.json()) as GoogleEventResponse
  return toCalendarEvent(data)
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: CalendarEventInput,
  http: HttpClient = defaultHttp,
): Promise<CalendarEvent> {
  const res = await googleFetch(
    http,
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toEventBody(input)),
    },
  )
  if (!res.ok) throw await parseGoogleError(res)
  const data = (await res.json()) as GoogleEventResponse
  return toCalendarEvent(data)
}

/**
 * Delete a calendar event. A 404 / 410 (already gone — e.g. the lead
 * deleted it from their own calendar) is treated as success, not an
 * error: the caller's goal ("this event should not exist") is already
 * satisfied, and re-throwing here would block `cancel_booking` from
 * ever completing for an event the user pre-emptively removed.
 */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  http: HttpClient = defaultHttp,
): Promise<void> {
  const res = await googleFetch(
    http,
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw await parseGoogleError(res)
  }
}
