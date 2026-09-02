// ============================================================
// Shared Google Calendar shapes — kept in their own file (no
// runtime imports) so client components can import the types
// without pulling in `google-calendar/api.ts`, which depends on
// `node:crypto` and the Supabase server client.
// ============================================================

export interface CalendarEventAttendee {
  email: string
  displayName: string | null
  /** Google's RSVP state: needsAction | declined | tentative | accepted. */
  responseStatus: string | null
  organizer: boolean
  self: boolean
}

export interface CalendarEvent {
  id: string
  summary: string
  description: string | null
  location: string | null
  /** RFC3339 datetime for timed events; `YYYY-MM-DD` for all-day ones. */
  start: string
  end: string
  allDay: boolean
  /** confirmed | tentative (cancelled events are filtered out upstream). */
  status: string
  htmlLink: string | null
  meetLink: string | null
  attendees: CalendarEventAttendee[]
  organizerEmail: string | null
}

/** Response of `GET /api/google-calendar/events`. `connected: false`
 *  carries an empty `events` array plus a `reason` the UI can explain. */
export interface CalendarEventsResponse {
  connected: boolean
  reason?: 'no_config' | 'token_error' | 'google_api_error'
  message?: string
  calendar_email?: string | null
  events: CalendarEvent[]
}
