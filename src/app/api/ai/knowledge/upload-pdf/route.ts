import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { extractPdfText, PdfExtractError } from '@/lib/pdf-extract'
import { supabaseAdmin } from '@/lib/ai/admin-client'

/**
 * POST /api/ai/knowledge/upload-pdf  (admin+)
 *
 * Upload a PDF file. Text is extracted and saved as a manual
 * knowledge-base document (type='manual').
 *
 * Body: multipart/form-data with field "file" and optional "title".
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
    }

    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'File is required.' }, { status: 400 })
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are accepted.' }, { status: 400 })
    }

    const titleRaw = formData.get('title')
    const title = typeof titleRaw === 'string' && titleRaw.trim()
      ? titleRaw.trim()
      : `PDF — ${file.name}`

    const buffer = await file.arrayBuffer()
    let text: string
    try {
      text = await extractPdfText(buffer)
    } catch (err) {
      const message = err instanceof PdfExtractError ? err.message : 'Failed to extract PDF text.'
      return NextResponse.json({ error: message }, { status: 422 })
    }

    const adminDb = supabaseAdmin()
    const { data: doc, error: insErr } = await adminDb
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        created_by: userId,
        type: 'manual',
        title,
        content: text,
      })
      .select('id')
      .single()
    if (insErr || !doc) {
      console.error('[ai/knowledge/upload-pdf] insert error:', insErr)
      return NextResponse.json({ error: 'Failed to save document.' }, { status: 500 })
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(supabase, accountId)
    let ingestWarning: string | undefined
    try {
      await ingestDocument(adminDb, accountId, { embeddingsApiKey }, doc.id, text)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'indexing failed'
      console.error('[ai/knowledge/upload-pdf] ingest error:', err)
      ingestWarning = `Saved, but semantic indexing failed (${message}). Lexical search still works.`
    }

    if (!ingestWarning && corrupt) {
      ingestWarning =
        'Saved with keyword search only — your embeddings key could not be decrypted.'
    }

    return NextResponse.json({
      success: true,
      id: doc.id,
      warning: ingestWarning,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
