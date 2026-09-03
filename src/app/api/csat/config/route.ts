import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  checkSharedRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { normalizeCsatConfigInput } from '@/lib/csat/config'

const SELECT_COLS =
  'enabled, template_name, template_language, scale, delay_minutes, cooldown_days, updated_at'

/**
 * GET /api/csat/config — the account's post-sale survey settings. Any
 * member may read (the settings form and a future KPIs hint both need
 * to know whether CSAT is on).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('csat_config')
      .select(SELECT_COLS)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[csat/config GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load CSAT config' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({
        configured: false,
        enabled: false,
        template_name: null,
        template_language: null,
        scale: 5,
        delay_minutes: 1440,
        cooldown_days: 30,
      })
    }
    return NextResponse.json({ configured: true, ...data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/csat/config (admin+) — upsert the account's survey
 * settings. One row per account; re-saving updates in place.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = await checkSharedRateLimit(
      `csat-config:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const normalized = normalizeCsatConfigInput(body as Record<string, unknown>)
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 })
    }

    const { error } = await supabase.from('csat_config').upsert(
      {
        account_id: accountId,
        created_by: userId,
        ...normalized.value,
      },
      { onConflict: 'account_id' },
    )
    if (error) {
      console.error('[csat/config POST] upsert error:', error)
      return NextResponse.json({ error: 'Failed to save CSAT config' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
