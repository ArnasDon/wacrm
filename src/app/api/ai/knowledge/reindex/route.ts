import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ai/knowledge/reindex  (admin+)
 *
 * Re-chunk and re-embed every document in the account. The main use is
 * after adding an embeddings key: existing documents were stored
 * lexical-only, and this backfills their vectors so semantic search
 * turns on. Also recovers documents whose indexing failed earlier.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb-reindex:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: docs, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, content')
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/knowledge/reindex] fetch error:', error)
      return NextResponse.json(
        { error: t('ai.knowledge.loadDocsFailed') },
        { status: 500 },
      )
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
      supabase,
      accountId,
    )
    // The whole point of Reindex is usually to backfill embeddings — so
    // if a key is configured but can't be decrypted, don't quietly do a
    // lexical-only pass and report success. Stop and tell the admin.
    if (corrupt) {
      return NextResponse.json(
        {
          success: false,
          reindexed: 0,
          error:
            t('ai.knowledge.reindexKeyCorrupt'),
        },
        { status: 200 },
      )
    }

    const total = (docs ?? []).length
    let reindexed = 0
    const failed: string[] = []
    const keywordOnly: string[] = []
    for (const doc of docs ?? []) {
      try {
        const result = await ingestDocument(supabase, accountId, { embeddingsApiKey }, doc.id, doc.content)
        reindexed += 1
        if (result.keywordOnly) {
          keywordOnly.push(doc.id)
          console.error(`[ai/knowledge/reindex] doc ${doc.id} keyword-only:`, describeError(result.embedError))
        }
      } catch (err) {
        failed.push(doc.id)
        console.error(`[ai/knowledge/reindex] doc ${doc.id} failed:`, describeError(err))
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      reindexed,
      total,
      failed,
      keyword_only: keywordOnly,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function describeError(err: unknown): string {
  return err instanceof AiError ? err.message : String(err)
}
