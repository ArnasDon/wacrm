import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseSheetCsv, InventoryError } from '@/lib/ai/inventory-parser'
import {
  accountDefaultCurrency,
  createDataSourceFromUrl,
  DataSourceError,
  findLegacyDefaultDataSource,
} from '@/lib/ai/data-sources/service'

/**
 * POST /api/ai/knowledge/sheet  (admin+)
 *
 * Kept for compatibility with AiKnowledgeCard's inventory uploader —
 * see the parallel comment in /api/ai/knowledge/upload/route.ts. Same
 * request/response contract; internally unified onto the structured
 * Data Sources pipeline (usage='both', upserting THE account's one
 * legacy source).
 *
 * Body: { url: string }
 *   The URL must be a published Google Sheet in CSV format:
 *   https://docs.google.com/spreadsheets/d/{ID}/export?format=csv
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-sheet:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const currency = await accountDefaultCurrency(supabase, accountId)

    const body = await request.json().catch(() => null)
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    if (!url) {
      return NextResponse.json({ error: 'url is required.' }, { status: 400 })
    }

    if (!url.includes('docs.google.com/spreadsheets')) {
      return NextResponse.json(
        { error: 'Not a valid Google Sheets URL. Publish your sheet as CSV and paste the export URL.' },
        { status: 400 },
      )
    }

    // Downloaded here (in addition to inside createDataSourceFromUrl)
    // only to keep returning `preview`/`metadata` in this route's
    // existing response shape without changing that public contract.
    let csvText: string
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) {
        return NextResponse.json(
          { error: `Failed to fetch sheet: HTTP ${res.status}. Make sure the sheet is published to the web as CSV.` },
          { status: 502 },
        )
      }
      csvText = await res.text()
    } catch {
      return NextResponse.json(
        { error: 'Could not reach the Google Sheets URL. Check the link and try again.' },
        { status: 502 },
      )
    }

    if (/^<!DOCTYPE html/i.test(csvText.trim()) || /^<html/i.test(csvText.trim())) {
      return NextResponse.json(
        { error: 'The URL returned an HTML page, not CSV. Publish your sheet: File → Share → Publish to the web → select "Comma-separated values (.csv)".' },
        { status: 422 },
      )
    }

    const selectedColumns: string[] | undefined =
      Array.isArray(body?.selectedColumns) ? body.selectedColumns : undefined

    let parsed
    try {
      parsed = parseSheetCsv(csvText, url, selectedColumns, currency)
    } catch (err) {
      const message = err instanceof InventoryError ? err.message : 'Failed to parse sheet data.'
      console.error('[ai/knowledge/sheet] parse error:', message)
      return NextResponse.json({ error: message }, { status: 422 })
    }

    const existing = await findLegacyDefaultDataSource(supabase, accountId)

    let source
    try {
      source = await createDataSourceFromUrl(supabase, {
        accountId,
        userId,
        sourceType: 'google_sheets',
        displayName: 'Inventario — Google Sheets',
        url,
        usage: 'both',
        currency,
        selectedColumns,
        existingId: existing?.id,
        isLegacyDefault: true,
      })
    } catch (err) {
      const message = err instanceof DataSourceError ? err.message : 'Failed to save inventory.'
      console.error('[ai/knowledge/sheet] createDataSourceFromUrl error:', err)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      id: source.id,
      preview: parsed.preview,
      metadata: parsed.metadata,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
