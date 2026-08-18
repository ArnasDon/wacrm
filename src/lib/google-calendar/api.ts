import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { getValidAccessToken, googleFetch, GoogleCalendarError } from './oauth'

// ============================================================
// Google Calendar API calls used by the AI's schedule_appointment
// action (see src/lib/ai/business-actions.ts) and its suggestion flow
// (POST /api/ai/suggest-action). Every call goes through
// getValidAccessToken() first, so the ~1h access-token lifetime is
// never this module's problem.
// ============================================================

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

/** How far ahead the AI (suggested or autonomous) is allowed to look
 *  when proposing an appointment slot — shared so both paths reason
 *  about the same window. A week is enough for "let's talk this week"
 *  without the freebusy query growing huge. */
export const APPOINTMENT_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000

async function loadCalendarId(db: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await db
    .from('google_calendar_config')
    .select('calendar_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw new GoogleCalendarError(error.message, 500)
  return data?.calendar_id || 'primary'
}

export interface BusyInterval {
  start: string
  end: string
}

/** Real free/busy intervals for the connected calendar in [timeMinISO,
 *  timeMaxISO) — the AI's suggest-action route feeds these to the model
 *  so it can only ever propose a slot that's actually open, never an
 *  invented one. Uses `calendar.freebusy` scope (never `calendar`), so
 *  it deliberately can't see event titles/attendees, just busy blocks. */
export async function checkFreeBusy(
  db: SupabaseClient,
  accountId: string,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<BusyInterval[]> {
  const accessToken = await getValidAccessToken(db, accountId)
  const calendarId = await loadCalendarId(db, accountId)
  const res = await googleFetch(`${CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: calendarId }] }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleCalendarError(`Google Calendar free/busy check failed: ${body}`, 502)
  }
  const data = (await res.json()) as { calendars?: Record<string, { busy?: BusyInterval[] }> }
  return data.calendars?.[calendarId]?.busy ?? []
}

export interface CreateEventArgs {
  summary: string
  description?: string
  startISO: string
  endISO: string
  attendeeEmail: string
  timeZone?: string
}

export interface CreatedEvent {
  eventId: string
  htmlLink: string | null
  meetLink: string | null
}

/** Creates the real calendar event with `sendUpdates: 'all'` — Google
 *  itself emails the invite (accept/decline buttons, correct calendar
 *  format) to `attendeeEmail`; nothing in this project's own email
 *  sender is involved. `conferenceDataVersion=1` + a Hangouts Meet
 *  createRequest attaches a real Google Meet link to the event. */
export async function createEvent(
  db: SupabaseClient,
  accountId: string,
  args: CreateEventArgs,
): Promise<CreatedEvent> {
  const accessToken = await getValidAccessToken(db, accountId)
  const calendarId = await loadCalendarId(db, accountId)
  const timeZone = args.timeZone ?? 'UTC'

  const res = await googleFetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all&conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: args.summary,
        description: args.description,
        start: { dateTime: args.startISO, timeZone },
        end: { dateTime: args.endISO, timeZone },
        attendees: [{ email: args.attendeeEmail }],
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleCalendarError(`Google Calendar event creation failed: ${body}`, 502)
  }
  const data = (await res.json()) as {
    id: string
    htmlLink?: string
    hangoutLink?: string
    conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] }
  }
  const meetLink =
    data.hangoutLink ??
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
    null
  return { eventId: data.id, htmlLink: data.htmlLink ?? null, meetLink }
}
