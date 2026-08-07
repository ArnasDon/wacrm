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

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

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

export async function createEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
  http: HttpClient = defaultHttp,
): Promise<CalendarEvent> {
  const res = await googleFetch(
    http,
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
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
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
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
