import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { parseSheetCsv, InventoryError } from '@/lib/ai/inventory-parser'
import { supabaseAdmin } from '@/lib/ai/admin-client'

/**
 * POST /api/ai/knowledge/sheet  (admin+)
 *
 * Import inventory from a Google Sheets public CSV URL.
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

    const body = await request.json().catch(() => null)
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    if (!url) {
      return NextResponse.json({ error: 'url is required.' }, { status: 400 })
    }

    // Validate it looks like a Google Sheets export URL.
    if (!url.includes('docs.google.com/spreadsheets')) {
      return NextResponse.json(
        { error: 'Not a valid Google Sheets URL. Publish your sheet as CSV and paste the export URL.' },
        { status: 400 },
      )
    }

    // Download the CSV.
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
    } catch (err) {
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
      parsed = parseSheetCsv(csvText, url, selectedColumns)
    } catch (err) {
      const message = err instanceof InventoryError ? err.message : 'Failed to parse sheet data.'
      console.error('[ai/knowledge/sheet] parse error:', message)
      return NextResponse.json({ error: message }, { status: 422 })
    }

    // Delete ALL existing inventory-type documents for this account.
    const adminDb = supabaseAdmin()
    const { error: delErr } = await adminDb
      .from('ai_knowledge_documents')
      .delete()
      .eq('account_id', accountId)
      .eq('type', 'inventory')
    if (delErr) {
      console.error('[ai/knowledge/sheet] delete error:', delErr)
      return NextResponse.json({ error: 'Failed to replace existing inventory.' }, { status: 500 })
    }

    // Insert the new inventory document.
    const title = `Inventario — Google Sheets`
    const { data: doc, error: insErr } = await adminDb
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        created_by: userId,
        type: 'inventory',
        title,
        content: parsed.content,
        metadata: parsed.metadata,
      })
      .select('id')
      .single()
    if (insErr || !doc) {
      console.error('[ai/knowledge/sheet] insert error:', insErr)
      return NextResponse.json({ error: 'Failed to save inventory document.' }, { status: 500 })
    }

    // Ingest (chunk + optionally embed).
    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(supabase, accountId)
    let ingestWarning: string | undefined
    try {
      await ingestDocument(adminDb, accountId, { embeddingsApiKey }, doc.id, parsed.content)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'indexing failed'
      console.error('[ai/knowledge/sheet] ingest error:', err)
      ingestWarning = `Saved, but semantic indexing failed (${message}). Lexical search still works.`
    }

    if (!ingestWarning && corrupt) {
      ingestWarning =
        'Saved with keyword search only — your embeddings key could not be decrypted.'
    }

    return NextResponse.json({
      success: true,
      id: doc.id,
      preview: parsed.preview,
      metadata: parsed.metadata,
      warning: ingestWarning,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
