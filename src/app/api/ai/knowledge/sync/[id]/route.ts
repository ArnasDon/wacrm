import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'
import { extractGoogleDocId, fetchGoogleDocText } from '@/lib/ai/google-docs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/ai/knowledge/sync/[id]  (admin+)
 *
 * Re-fetch a `source_type='google_doc'` document from its saved
 * `source_url` and re-index it. The "Sync now" button — for editing
 * the URL itself, use PATCH /api/ai/knowledge/[id] instead.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb-sync:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const { data: doc, error: fetchError } = await supabase
      .from('ai_knowledge_documents')
      .select('id, source_type, source_url')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (fetchError) {
      console.error('[ai/knowledge/sync] fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to load document' }, { status: 500 })
    }
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (doc.source_type !== 'google_doc' || !doc.source_url) {
      return NextResponse.json(
        { error: 'This document has no Google Doc source to sync from' },
        { status: 400 },
      )
    }

    const docId = extractGoogleDocId(doc.source_url)
    if (!docId) {
      return NextResponse.json({ error: 'Saved source_url is not a valid Google Docs link' }, { status: 400 })
    }

    let content: string
    try {
      content = await fetchGoogleDocText(docId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo leer el documento'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from('ai_knowledge_documents')
      .update({ content, last_synced_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('id', id)
    if (updateError) {
      console.error('[ai/knowledge/sync] update error:', updateError)
      return NextResponse.json({ error: 'Failed to save synced content' }, { status: 500 })
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(supabase, accountId)
    try {
      await ingestDocument(supabase, accountId, { embeddingsApiKey }, id, content)
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'indexing failed'
      console.error('[ai/knowledge/sync] ingest error:', err)
      return NextResponse.json(
        {
          success: true,
          warning: `Synced, but semantic indexing failed (${message}). Lexical search still works; use Reindex to retry.`,
        },
        { status: 200 },
      )
    }

    if (corrupt) {
      return NextResponse.json({
        success: true,
        warning:
          'Synced with keyword search only — your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key).',
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
