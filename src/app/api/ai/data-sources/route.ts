import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  createDataSourceFromFile,
  createDataSourceFromUrl,
  DataSourceError,
  listDataSources,
} from '@/lib/ai/data-sources/service'
import type { DataSourceUsage, FallbackPolicy } from '@/lib/ai/data-sources/types'

const USAGE_VALUES: DataSourceUsage[] = ['knowledge', 'catalog', 'both']
const FALLBACK_VALUES: FallbackPolicy[] = ['primary_only', 'fallback_on_not_found', 'search_all_active']

/**
 * GET /api/ai/data-sources  (viewer+)
 * List every Data Source configured for the account, primary-first
 * then by priority.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const sources = await listDataSources(supabase, accountId)
    return NextResponse.json({ data_sources: sources })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/data-sources  (admin+)
 *
 * Creates ONE new Data Source (google_sheets / remote_csv / uploaded_csv).
 * Always multipart/form-data so the same route handles both a `url`
 * text field (sheets/remote CSV) and a `file` field (uploaded CSV).
 *
 * Fields: source_type, display_name, usage, url|file, priority?,
 * is_primary?, fallback_policy?, currency?, selected_columns? (JSON
 * array string).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-data-source-create:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 })
    }

    const sourceType = String(formData.get('source_type') ?? '')
    const displayName = String(formData.get('display_name') ?? '').trim()
    const usage = String(formData.get('usage') ?? 'knowledge') as DataSourceUsage
    const fallbackPolicy = (formData.get('fallback_policy')
      ? String(formData.get('fallback_policy'))
      : 'fallback_on_not_found') as FallbackPolicy
    const priorityRaw = formData.get('priority')
    const priority = priorityRaw ? Number(priorityRaw) : undefined
    const isPrimary = formData.get('is_primary') === 'true'
    const currency = formData.get('currency') ? String(formData.get('currency')) : undefined

    if (!displayName) {
      return NextResponse.json({ error: 'display_name is required.' }, { status: 400 })
    }
    if (!USAGE_VALUES.includes(usage)) {
      return NextResponse.json({ error: `usage must be one of: ${USAGE_VALUES.join(', ')}` }, { status: 400 })
    }
    if (!FALLBACK_VALUES.includes(fallbackPolicy)) {
      return NextResponse.json(
        { error: `fallback_policy must be one of: ${FALLBACK_VALUES.join(', ')}` },
        { status: 400 },
      )
    }

    let selectedColumns: string[] | undefined
    try {
      const raw = formData.get('selected_columns')
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) selectedColumns = parsed
      }
    } catch {
      /* ignore malformed hint — parser falls back to auto-detection */
    }

    if (sourceType === 'google_sheets' || sourceType === 'remote_csv') {
      const url = String(formData.get('url') ?? '').trim()
      if (!url) return NextResponse.json({ error: 'url is required for this source_type.' }, { status: 400 })
      const source = await createDataSourceFromUrl(supabase, {
        accountId,
        userId,
        sourceType,
        displayName,
        url,
        usage,
        priority,
        isPrimary,
        fallbackPolicy,
        currency,
        selectedColumns,
      })
      return NextResponse.json({ success: true, data_source: source })
    }

    if (sourceType === 'uploaded_csv') {
      const file = formData.get('file')
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'file is required for source_type "uploaded_csv".' }, { status: 400 })
      }
      const buffer = await file.arrayBuffer()
      const source = await createDataSourceFromFile(supabase, {
        accountId,
        userId,
        displayName,
        filename: file.name,
        buffer,
        usage,
        priority,
        isPrimary,
        fallbackPolicy,
        currency,
        selectedColumns,
      })
      return NextResponse.json({ success: true, data_source: source })
    }

    return NextResponse.json(
      { error: 'source_type must be one of: google_sheets, remote_csv, uploaded_csv' },
      { status: 400 },
    )
  } catch (err) {
    if (err instanceof DataSourceError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    return toErrorResponse(err)
  }
}
