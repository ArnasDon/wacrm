import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseKnowledgeImport } from '@/lib/ai/knowledge-import'
import { upsertKnowledgeDocs } from '@/lib/ai/knowledge-import-server'

/**
 * POST /api/ai/knowledge/import  (admin+)
 *
 * Body: `{ "documents": [{ "title": "...", "content": "..." }, …] }`
 * (or a bare array). Upserts by title: a title that already exists has
 * its content replaced and is re-chunked; new titles are created. One
 * failing document never aborts the rest — the response reports counts
 * and any per-document warnings.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb-import:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const parsed = parseKnowledgeImport(await request.json().catch(() => null))
    if (!parsed.ok) {
      return NextResponse.json(
        { error: 'Invalid knowledge file.', details: parsed.errors },
        { status: 400 },
      )
    }
    try {
      const r = await upsertKnowledgeDocs(supabase, accountId, userId, parsed.documents)
      return NextResponse.json({ success: true, ...r })
    } catch (err) {
      console.error('[ai/knowledge/import] error:', err)
      return NextResponse.json({ error: 'Failed to load knowledge base' }, { status: 500 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
