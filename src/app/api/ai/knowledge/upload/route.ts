import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseInventoryFile, InventoryError } from '@/lib/ai/inventory-parser'
import {
  accountDefaultCurrency,
  createDataSourceFromFile,
  DataSourceError,
  findLegacyDefaultDataSource,
} from '@/lib/ai/data-sources/service'

/**
 * POST /api/ai/knowledge/upload  (admin+)
 *
 * Kept for compatibility with AiKnowledgeCard's inventory uploader
 * (src/components/settings/ai-knowledge.tsx) — SAME request/response
 * contract as before, but internally unified onto the structured
 * pipeline (AI_Catalog_Fix_Kit FASE 2/3): this now upserts THE
 * account's one legacy data source (ai_data_sources, usage='both') via
 * src/lib/ai/data-sources/service.ts instead of writing directly to a
 * standalone ai_knowledge_documents(type='inventory') row. `usage:
 * 'both'` preserves the old "inventory text is searchable in the KB"
 * behavior while ALSO making it queryable by the catalog tools
 * (search_catalog/get_product/...) — one inventory, one pipeline, no
 * second independent catalog.
 *
 * Body: multipart/form-data with field "file".
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-upload:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const currency = await accountDefaultCurrency(supabase, accountId)

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

    // Parsed here (in addition to inside createDataSourceFromFile) only
    // to keep returning `preview`/`metadata` in this route's existing
    // response shape without changing that public contract — cheap for
    // the CSV/Excel sizes this UI targets.
    let parsed
    try {
      parsed = parseInventoryFile(buffer, filename, selectedColumns, currency)
    } catch (err) {
      const message = err instanceof InventoryError ? err.message : 'Failed to parse file.'
      return NextResponse.json({ error: message }, { status: 422 })
    }

    const existing = await findLegacyDefaultDataSource(supabase, accountId)

    let source
    try {
      source = await createDataSourceFromFile(supabase, {
        accountId,
        userId,
        displayName: `Inventario — ${filename}`,
        filename,
        buffer,
        usage: 'both',
        currency,
        selectedColumns,
        existingId: existing?.id,
        isLegacyDefault: true,
      })
    } catch (err) {
      const message = err instanceof DataSourceError ? err.message : 'Failed to save inventory.'
      console.error('[ai/knowledge/upload] createDataSourceFromFile error:', err)
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
