import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { resolveTimeZone, zonedDayKey, zonedDayStart, zonedLastNDayKeys } from '@/lib/ai/usage-days'
import { fetchPagesUpTo } from '@/lib/supabase/paged-query'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

// Rows are aggregated in-process over a bounded window. An active
// account writes a handful of rows per conversation, so 30 days sits
// comfortably under this cap; we surface `truncated` when it doesn't so
// the UI can say "showing a partial window" rather than under-reporting
// silently.
const MAX_ROWS = 10_000
const DEFAULT_WINDOW_DAYS = 30

interface UsageRow {
  created_at: string
  mode: 'auto_reply' | 'draft'
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/**
 * GET /api/ai/usage?days=30&tz=Europe/Vilnius  (admin+)
 *
 * Token-spend summary for the account's BYO key over the last `days`
 * (1–90, default 30): totals, per-mode + per-model breakdowns, and a
 * zero-filled daily series for charting. Admin-only, mirroring the
 * `ai_usage_log` SELECT policy — spend is billing-class.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const url = new URL(request.url)
    const rawDays = Number(url.searchParams.get('days'))
    // Guard `>= 1`, not just `isFinite`: a missing/blank param is
    // Number(null)/Number('') === 0, which is finite — without the lower
    // bound the default would never apply and the window would collapse
    // to a single day.
    const days =
      Number.isFinite(rawDays) && rawDays >= 1
        ? Math.min(90, Math.floor(rawDays))
        : DEFAULT_WINDOW_DAYS

    const timeZone = resolveTimeZone(url.searchParams.get('tz'))
    const dayKeys = zonedLastNDayKeys(days, timeZone)
    const since = zonedDayStart(dayKeys[0], timeZone)

    let all: UsageRow[]
    try {
      all = await fetchPagesUpTo<UsageRow>(
        (from, to) =>
          supabase
            .from('ai_usage_log')
            .select(
              'created_at, mode, provider, model, prompt_tokens, completion_tokens, total_tokens',
            )
            .eq('account_id', accountId)
            .gte('created_at', since.toISOString())
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to),
        MAX_ROWS + 1,
      )
    } catch (error) {
      console.error('[ai/usage GET] fetch error:', error)
      return NextResponse.json(
        { error: t('ai.loadUsageFailed') },
        { status: 500 },
      )
    }

    const truncated = all.length > MAX_ROWS
    const rows = truncated ? all.slice(0, MAX_ROWS) : all

    // Totals.
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0

    // Per-mode + per-model tallies.
    const byMode = {
      auto_reply: { calls: 0, tokens: 0 },
      draft: { calls: 0, tokens: 0 },
    }
    const modelMap = new Map<
      string,
      { model: string; provider: string; calls: number; tokens: number }
    >()

    // Zero-filled daily buckets so the chart shows quiet days as gaps,
    // not missing points. Oldest → newest, in the caller's time zone.
    const daily = new Map<string, { date: string; tokens: number; calls: number }>()
    for (const key of dayKeys) {
      daily.set(key, { date: key, tokens: 0, calls: 0 })
    }

    for (const r of rows) {
      promptTokens += r.prompt_tokens
      completionTokens += r.completion_tokens
      totalTokens += r.total_tokens

      // `mode` is DB-CHECK-constrained to these two values.
      byMode[r.mode].calls += 1
      byMode[r.mode].tokens += r.total_tokens

      const mk = `${r.provider}:${r.model}`
      const m =
        modelMap.get(mk) ??
        { model: r.model, provider: r.provider, calls: 0, tokens: 0 }
      m.calls += 1
      m.tokens += r.total_tokens
      modelMap.set(mk, m)

      const bucket = daily.get(zonedDayKey(r.created_at, timeZone))
      if (bucket) {
        bucket.tokens += r.total_tokens
        bucket.calls += 1
      }
    }

    const byModel = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens)

    return NextResponse.json({
      window_days: days,
      time_zone: timeZone,
      truncated,
      totals: {
        calls: rows.length,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
      by_mode: byMode,
      by_model: byModel,
      daily: [...daily.values()],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
