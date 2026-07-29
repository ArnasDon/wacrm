import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { parseInventoryFile, InventoryError } from '@/lib/ai/inventory-parser'
import { supabaseAdmin } from '@/lib/ai/admin-client'

/**
 * POST /api/ai/knowledge/upload  (admin+)
 *
 * Upload a CSV or Excel inventory file. Parses it into a single
 * KB document (type='inventory'), replacing any previous inventory
 * document atomically.
 *
 * Body: multipart/form-data with field "file".
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-upload:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
    }

    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'File is required.' }, { status: 400 })
    }

    const filename = file.name
    const ext = filename.toLowerCase().split('.').pop()
    if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
      return NextResponse.json(
        { error: 'Unsupported format. Upload a CSV or Excel (.xlsx) file.' },
        { status: 400 },
      )
    }

    const buffer = await file.arrayBuffer()
    let selectedColumns: string[] | undefined
    try {
      const raw = formData.get('selectedColumns')
      if (typeof raw === 'string') {
        selectedColumns = JSON.parse(raw)
        if (!Array.isArray(selectedColumns)) selectedColumns = undefined
      }
    } catch { /* ignore */ }

    let parsed
    try {
      parsed = parseInventoryFile(buffer, filename, selectedColumns)
    } catch (err) {
      const message = err instanceof InventoryError ? err.message : 'Failed to parse file.'
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
      console.error('[ai/knowledge/upload] delete error:', delErr)
      return NextResponse.json({ error: 'Failed to replace existing inventory.' }, { status: 500 })
    }

    // Insert the new inventory document.
    const title = `Inventario — ${filename}`
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
      console.error('[ai/knowledge/upload] insert error:', insErr)
      return NextResponse.json({ error: 'Failed to save inventory document.' }, { status: 500 })
    }

    // Ingest (chunk + optionally embed).
    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(supabase, accountId)
    let ingestWarning: string | undefined
    try {
      await ingestDocument(adminDb, accountId, { embeddingsApiKey }, doc.id, parsed.content)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'indexing failed'
      console.error('[ai/knowledge/upload] ingest error:', err)
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
