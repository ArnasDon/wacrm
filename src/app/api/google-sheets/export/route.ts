import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getValidAccessToken, GoogleSheetsError } from '@/lib/google-sheets/oauth'
import { clearAndWrite, ensureTab } from '@/lib/google-sheets/api'
import { exportEntity, isExportEntity } from '@/lib/google-sheets/bulk-export'

/**
 * POST /api/google-sheets/export   (admin+)
 * Body: { entity: 'contacts' | 'deals' | 'quotes' | 'products' }
 *
 * Phase 2 — dumps the account's current rows for that entity into a
 * dedicated tab of the connected spreadsheet ("Export <Entidad>"),
 * replacing whatever was there. One-shot; not a live sync.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = (await request.json().catch(() => null)) as { entity?: unknown } | null
    if (!body || !isExportEntity(body.entity)) {
      return NextResponse.json(
        { error: "entity must be one of 'contacts', 'deals', 'quotes', 'products'" },
        { status: 400 },
      )
    }

    const { data: config, error } = await supabase
      .from('google_sheets_config')
      .select('spreadsheet_id, status')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Could not load Sheets config' }, { status: 500 })
    if (!config || config.status !== 'connected' || !config.spreadsheet_id) {
      return NextResponse.json({ error: 'Google Sheets is not connected, or no spreadsheet is selected.' }, { status: 400 })
    }

    const result = await exportEntity(supabase, accountId, body.entity)

    try {
      const token = await getValidAccessToken(supabase, accountId)
      await ensureTab(token, config.spreadsheet_id as string, result.tab)
      await clearAndWrite(token, config.spreadsheet_id as string, result.tab, result.rows)
      await supabase
        .from('google_sheets_config')
        .update({ last_write_at: new Date().toISOString() })
        .eq('account_id', accountId)
    } catch (err) {
      const message = err instanceof GoogleSheetsError ? err.message : 'Sheets write failed'
      const status = err instanceof GoogleSheetsError ? err.status : 502
      return NextResponse.json({ error: message }, { status })
    }

    return NextResponse.json({
      success: true,
      tab: result.tab,
      row_count: result.rowCount,
      truncated: result.truncated,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
