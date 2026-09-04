import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  parseInventoryFile,
  parseSheetCsv,
  InventoryError,
} from '@/lib/ai/inventory-parser'
import { accountDefaultCurrency } from '@/lib/ai/data-sources/service'

/**
 * POST /api/ai/knowledge/inventory/preview  (admin+)
 *
 * Parse a CSV/Excel file or Google Sheets URL and return the column
 * detection + sample rows WITHOUT saving anything to the database.
 *
 * Body (multipart):
 *   file: File  (CSV or Excel)
 *
 * Body (JSON):
 *   { url: "https://docs.google.com/spreadsheets/d/.../export?format=csv" }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-inventory:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    // Same source of truth as the rest of the pipeline — see
    // src/lib/ai/data-sources/service.ts::accountDefaultCurrency. This
    // route never persists anything, but the preview it shows should
    // match what an actual import would use.
    const currency = await accountDefaultCurrency(supabase, accountId)

    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData().catch(() => null)
      if (!formData) {
        return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
      }

      const file = formData.get('file')
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'File is required.' }, { status: 400 })
      }

      const ext = file.name.toLowerCase().split('.').pop()
      if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
        return NextResponse.json(
          { error: 'Unsupported format. Upload a CSV or Excel (.xlsx) file.' },
          { status: 400 },
        )
      }

      const buffer = await file.arrayBuffer()
      try {
        const parsed = parseInventoryFile(buffer, file.name, undefined, currency)
        return NextResponse.json({ preview: parsed.preview, metadata: parsed.metadata })
      } catch (err) {
        const message = err instanceof InventoryError ? err.message : 'Failed to parse file.'
        return NextResponse.json({ error: message }, { status: 422 })
      }
    }

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

    let csvText: string
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) {
        return NextResponse.json(
          { error: `Failed to fetch sheet: HTTP ${res.status}.` },
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

    const csvStart = csvText.trim().slice(0, 200)
    if (/^<!DOCTYPE html/i.test(csvStart) || /^<html/i.test(csvStart)) {
      console.error('[preview] sheet returned HTML:', csvStart)
      return NextResponse.json(
        { error: 'The URL returned an HTML page, not CSV. Publish your sheet: File → Share → Publish to the web → select "Comma-separated values (.csv)".' },
        { status: 422 },
      )
    }

    try {
      const parsed = parseSheetCsv(csvText, url, undefined, currency)
      return NextResponse.json({ preview: parsed.preview, metadata: parsed.metadata })
    } catch (err) {
      const message = err instanceof InventoryError ? err.message : `Failed to parse sheet: ${err}`
      console.error('[preview] parseSheetCsv error:', message)
      return NextResponse.json({ error: message }, { status: 422 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
