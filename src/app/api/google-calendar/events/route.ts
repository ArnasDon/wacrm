import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { listEvents } from '@/lib/google-calendar/api'
import { GoogleCalendarError } from '@/lib/google-calendar/oauth'
import type { CalendarEventsResponse } from '@/lib/google-calendar/types'

/**
 * GET /api/google-calendar/events?start=<ISO>&end=<ISO>
 *
 * Events on the account's connected Google Calendar in the given
 * window — feeds the in-CRM calendar page (month / week / agenda).
 * Read-only, so any signed-in account member may call it (same tier
 * as GET /api/google-calendar/config).
 *
 * A missing connection or a dead token is NOT an error here: it comes
 * back `200 { connected: false, reason, events: [] }` so the page can
 * render a "connect your calendar" state instead of a broken view —
 * the same soft-shape contract the config route uses.
 */

// A month grid with overscan is ~6 weeks; cap the window so a
// hand-crafted query string can't make us pull a year of events.
const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000
const DEFAULT_RANGE_MS = 31 * 24 * 60 * 60 * 1000

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { searchParams } = new URL(request.url)
    const now = Date.now()
    const start = searchParams.get('start') ? new Date(searchParams.get('start')!) : new Date(now)
    let end = searchParams.get('end')
      ? new Date(searchParams.get('end')!)
      : new Date(now + DEFAULT_RANGE_MS)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return NextResponse.json({ error: 'Invalid start/end range' }, { status: 400 })
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
      end = new Date(start.getTime() + MAX_RANGE_MS)
    }

    const { data: cfg } = await supabase
      .from('google_calendar_config')
      .select('calendar_email')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!cfg) {
      const body: CalendarEventsResponse = { connected: false, reason: 'no_config', events: [] }
      return NextResponse.json(body)
    }

    try {
      const events = await listEvents(supabase, accountId, start.toISOString(), end.toISOString())
      const body: CalendarEventsResponse = {
        connected: true,
        calendar_email: cfg.calendar_email,
        events,
      }
      return NextResponse.json(body)
    } catch (err) {
      const message = err instanceof GoogleCalendarError ? err.message : 'Unknown error'
      // A 400/401 from the token layer means "reconnect needed" —
      // `getValidAccessToken` has already flipped the config row to
      // disconnected and alerted. Anything else (Google 5xx, timeout)
      // is transient; either way the page shows a non-fatal notice.
      const reason =
        err instanceof GoogleCalendarError && (err.status === 400 || err.status === 401)
          ? 'token_error'
          : 'google_api_error'
      if (reason === 'google_api_error') {
        console.error('[google-calendar/events GET] listEvents failed:', message)
      }
      const body: CalendarEventsResponse = { connected: false, reason, message, events: [] }
      return NextResponse.json(body)
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
