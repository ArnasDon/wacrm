import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { getValidAccessToken, GoogleSheetsError } from '@/lib/google-sheets/oauth'
import { getSpreadsheetMeta } from '@/lib/google-sheets/api'
import { isWebhookEvent } from '@/lib/webhooks/events'

// Events the row builder actually knows how to lay out. A subset of
// WEBHOOK_EVENTS — status/message events don't make sense as a report.
const SHEETABLE_EVENTS = [
  'deal.won',
  'deal.stage_changed',
  'quote.created',
  'contact.created',
  'contact.lead_temperature_changed',
  'appointment.scheduled',
  'broadcast.completed',
] as const

/** GET — connection + target-sheet status for the caller's account. */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data: config, error } = await supabase
      .from('google_sheets_config')
      .select('google_email, spreadsheet_id, spreadsheet_name, sheet_tab, events, status, last_write_at, last_connection_error')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[google-sheets/config GET] fetch failed:', error)
      return NextResponse.json({ connected: false, reason: 'db_error' }, { status: 200 })
    }
    if (!config) {
      return NextResponse.json({ connected: false, reason: 'no_config', sheetable_events: SHEETABLE_EVENTS }, { status: 200 })
    }

    // Cheap liveness check: a metadata read on the picked spreadsheet
    // (or, if none picked yet, just prove the token refreshes).
    try {
      const token = await getValidAccessToken(supabase, accountId)
      if (config.spreadsheet_id) {
        await getSpreadsheetMeta(token, config.spreadsheet_id as string)
      }
    } catch (err) {
      const message = err instanceof GoogleSheetsError ? err.message : 'Unknown error'
      return NextResponse.json(
        { connected: false, reason: 'token_error', needs_reset: true, message, sheetable_events: SHEETABLE_EVENTS },
        { status: 200 },
      )
    }

    return NextResponse.json({
      connected: config.status === 'connected',
      google_email: config.google_email,
      spreadsheet_id: config.spreadsheet_id,
      spreadsheet_name: config.spreadsheet_name,
      sheet_tab: config.sheet_tab,
      events: config.events ?? [],
      last_write_at: config.last_write_at,
      sheetable_events: SHEETABLE_EVENTS,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT — set the target spreadsheet, base tab and subscribed events.
 * Body: { spreadsheet_id | spreadsheet_url, sheet_tab?, events? }
 * Validates the spreadsheet is reachable by the connected account.
 */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    const raw = typeof body.spreadsheet_id === 'string'
      ? body.spreadsheet_id
      : typeof body.spreadsheet_url === 'string'
        ? body.spreadsheet_url
        : ''
    // Accept a bare id or a full /spreadsheets/d/<id>/edit URL.
    const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
    const spreadsheetId = (idMatch ? idMatch[1] : raw).trim()
    if (!spreadsheetId) {
      return NextResponse.json({ error: 'spreadsheet_id or spreadsheet_url is required' }, { status: 400 })
    }

    const sheetTab = typeof body.sheet_tab === 'string' && body.sheet_tab.trim()
      ? body.sheet_tab.trim().slice(0, 80)
      : 'Ventas'

    let events: string[] = ['deal.won']
    if (Array.isArray(body.events)) {
      const cleaned = body.events.filter(
        (e): e is string =>
          typeof e === 'string' && isWebhookEvent(e) && (SHEETABLE_EVENTS as readonly string[]).includes(e),
      )
      if (cleaned.length === 0) {
        return NextResponse.json({ error: 'events must contain at least one supported event' }, { status: 400 })
      }
      events = [...new Set(cleaned)]
    }

    let spreadsheetName: string
    try {
      const token = await getValidAccessToken(supabase, accountId)
      const meta = await getSpreadsheetMeta(token, spreadsheetId)
      spreadsheetName = meta.title
    } catch (err) {
      const message = err instanceof GoogleSheetsError ? err.message : 'Could not open that spreadsheet'
      const status = err instanceof GoogleSheetsError ? err.status : 400
      return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 400 })
    }

    const { error } = await supabase
      .from('google_sheets_config')
      .update({
        spreadsheet_id: spreadsheetId,
        spreadsheet_name: spreadsheetName,
        sheet_tab: sheetTab,
        events,
        headers_written: {},
      })
      .eq('account_id', accountId)
    if (error) {
      console.error('[google-sheets/config PUT] update failed:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ success: true, spreadsheet_name: spreadsheetName, sheet_tab: sheetTab, events })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE — disconnect: drop the stored (encrypted) tokens + settings. */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase.from('google_sheets_config').delete().eq('account_id', accountId)
    if (error) {
      console.error('[google-sheets/config DELETE] failed:', error)
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
