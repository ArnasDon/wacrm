import type { SupabaseClient } from '@supabase/supabase-js'
import type { WebhookEvent } from '@/lib/webhooks/events'
import { supabaseAdmin } from './admin-client'
import { getValidAccessToken } from './oauth'
import { buildRowForEvent } from './row-builder'
import { appendRows, ensureTab } from './api'

// ============================================================
// `dispatchToGoogleSheets` — called from inside `dispatchWebhookEvent`
// so every existing event source also feeds a connected Google Sheet
// with zero extra call sites. Best-effort: never throws.
//
// Uses a service-role client (not whatever the caller passed) so it
// works from `after()` blocks / background jobs the same as the outbound
// webhook path, and reads its own row data account-scoped.
// ============================================================

interface ConfigRow {
  spreadsheet_id: string | null
  sheet_tab: string
  events: string[]
  headers_written: Record<string, unknown> | null
  status: string
}

export async function dispatchToGoogleSheets(
  _callerDb: SupabaseClient,
  accountId: string,
  event: WebhookEvent,
  data: unknown,
): Promise<void> {
  try {
    const db = supabaseAdmin()

    const { data: config } = await db
      .from('google_sheets_config')
      .select('spreadsheet_id, sheet_tab, events, headers_written, status')
      .eq('account_id', accountId)
      .maybeSingle<ConfigRow>()

    if (
      !config ||
      config.status !== 'connected' ||
      !config.spreadsheet_id ||
      !Array.isArray(config.events) ||
      !config.events.includes(event)
    ) {
      return
    }

    const row = await buildRowForEvent(db, accountId, event, data, config.sheet_tab)
    if (!row) return

    const token = await getValidAccessToken(db, accountId)

    await ensureTab(token, config.spreadsheet_id, row.tab)

    const written = (config.headers_written ?? {}) as Record<string, unknown>
    const needsHeader = written[row.tab] !== true
    const rows = needsHeader ? [row.header, row.values] : [row.values]

    await appendRows(token, config.spreadsheet_id, row.tab, rows)

    const patch: Record<string, unknown> = { last_write_at: new Date().toISOString() }
    if (needsHeader) {
      patch.headers_written = { ...written, [row.tab]: true }
    }
    await db.from('google_sheets_config').update(patch).eq('account_id', accountId)
  } catch (err) {
    console.error('[google-sheets] dispatch failed for', event, err instanceof Error ? err.message : err)
  }
}
