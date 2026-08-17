import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { getValidAccessToken, GoogleCalendarError } from '@/lib/google-calendar/oauth'

/**
 * GET /api/google-calendar/config
 *
 * Connection status for the caller's account, verified with a live
 * Calendar API call (not just "a row exists") — same "GET always
 * re-checks against the provider" contract as
 * GET /api/instagram/config / GET /api/whatsapp/config.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data: config, error } = await supabase
      .from('google_calendar_config')
      .select('calendar_email, calendar_id, status')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[google-calendar/config GET] fetch failed:', error)
      return NextResponse.json({ connected: false, reason: 'db_error' }, { status: 200 })
    }
    if (!config) {
      return NextResponse.json({ connected: false, reason: 'no_config' }, { status: 200 })
    }

    try {
      const accessToken = await getValidAccessToken(supabase, accountId)
      // A plain `calendars.get` needs the `calendar`/`calendar.readonly`
      // scope, which this app deliberately never requests (see oauth.ts).
      // `freeBusy.query` is covered by the narrower `calendar.freebusy`
      // scope we do have, so it doubles as the live connectivity check —
      // a 1-minute window starting now is cheap and returns 200 as long
      // as the token/calendar are valid, regardless of what's on it.
      const now = new Date()
      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: now.toISOString(),
          timeMax: new Date(now.getTime() + 60_000).toISOString(),
          items: [{ id: config.calendar_id }],
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return NextResponse.json(
          { connected: false, reason: 'google_api_error', message: body },
          { status: 200 },
        )
      }
    } catch (err) {
      const message = err instanceof GoogleCalendarError ? err.message : 'Unknown error'
      return NextResponse.json(
        { connected: false, reason: 'token_error', needs_reset: true, message },
        { status: 200 },
      )
    }

    return NextResponse.json({ connected: true, calendar_email: config.calendar_email })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/google-calendar/config
 *
 * Disconnects — removes the stored (encrypted) tokens. Google itself
 * still shows Chat Sandía as an authorized app under the user's
 * Google Account until they separately revoke it there; this only
 * clears our side, same scope as every other "Reset Configuration"
 * button in Settings.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase.from('google_calendar_config').delete().eq('account_id', accountId)
    if (error) {
      console.error('[google-calendar/config DELETE] failed:', error)
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
