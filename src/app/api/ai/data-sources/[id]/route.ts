import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { deleteDataSource, updateDataSourceMeta } from '@/lib/ai/data-sources/service'
import type { DataSourceUsage, FallbackPolicy } from '@/lib/ai/data-sources/types'

const USAGE_VALUES: DataSourceUsage[] = ['knowledge', 'catalog', 'both']
const FALLBACK_VALUES: FallbackPolicy[] = ['primary_only', 'fallback_on_not_found', 'search_all_active']

/**
 * PATCH /api/ai/data-sources/[id]  (admin+)
 * Updates metadata only (display name, usage, priority, is_primary,
 * fallback_policy, status, currency) — does NOT re-parse content. Use
 * POST .../refresh to re-fetch/re-parse.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-data-source-update:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => ({}))

    if (body.usage !== undefined && !USAGE_VALUES.includes(body.usage)) {
      return NextResponse.json({ error: `usage must be one of: ${USAGE_VALUES.join(', ')}` }, { status: 400 })
    }
    if (body.fallback_policy !== undefined && !FALLBACK_VALUES.includes(body.fallback_policy)) {
      return NextResponse.json(
        { error: `fallback_policy must be one of: ${FALLBACK_VALUES.join(', ')}` },
        { status: 400 },
      )
    }
    if (body.status !== undefined && !['active', 'disabled', 'error'].includes(body.status)) {
      return NextResponse.json({ error: 'status must be one of: active, disabled, error' }, { status: 400 })
    }

    const source = await updateDataSourceMeta(supabase, accountId, id, {
      displayName: body.display_name,
      usage: body.usage,
      status: body.status,
      priority: body.priority,
      isPrimary: body.is_primary,
      fallbackPolicy: body.fallback_policy,
      currency: body.currency,
    })
    return NextResponse.json({ success: true, data_source: source })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/ai/data-sources/[id]  (admin+) */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-data-source-delete:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    await deleteDataSource(supabase, accountId, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
