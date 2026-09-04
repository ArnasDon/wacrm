import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { daysAgoStart, lastNDayKeys, localDayKey } from '@/lib/dashboard/date-utils'

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
  // Anthropic prompt caching (FASE 8/9, migration 051) — NULL for every
  // OpenAI/OpenRouter row and for any Anthropic row that didn't engage
  // caching. Never coerced to 0 here either — see the aggregation below.
  cache_creation_input_tokens: number | null
  cache_read_input_tokens: number | null
  // Breakdown metrics (migration 049) — FASE 12 surfaces these as
  // aggregate observability instead of only per-row detail.
  catalog_attached: boolean | null
  catalog_used: boolean | null
  knowledge_retrieved: boolean | null
  knowledge_skipped_by_routing: boolean | null
  routing_decision: 'catalog' | 'knowledge' | 'both' | 'neither' | null
  // Budun observability (migration 052, FASE 12).
  catalog_external_used: boolean | null
  catalog_external_blocked: boolean | null
}

/**
 * GET /api/ai/usage?days=30  (admin+)
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

    // Align the query cutoff to the START of the oldest local day we'll
    // chart (not a rolling `now - N*24h` instant). Otherwise rows in the
    // oldest partial day would be counted in the totals but fall outside
    // every daily bucket, so the chart's bars wouldn't sum to the
    // headline total. Local-day boundaries match every other dashboard
    // chart (see lib/dashboard/date-utils).
    const since = daysAgoStart(days - 1)

    // A single string literal (not a `+`-concatenation) — Supabase's
    // `.select()` typing parses this exact literal to infer the row
    // shape; a concatenated `string` degrades to a generic/untyped
    // result instead.
    const { data, error } = await supabase
      .from('ai_usage_log')
      .select(
        'created_at, mode, provider, model, prompt_tokens, completion_tokens, total_tokens, cache_creation_input_tokens, cache_read_input_tokens, catalog_attached, catalog_used, knowledge_retrieved, knowledge_skipped_by_routing, routing_decision, catalog_external_used, catalog_external_blocked',
      )
      .eq('account_id', accountId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS + 1)

    if (error) {
      console.error('[ai/usage GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load usage' },
        { status: 500 },
      )
    }

    const all = (data ?? []) as UsageRow[]
    const truncated = all.length > MAX_ROWS
    const rows = truncated ? all.slice(0, MAX_ROWS) : all

    // Totals.
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0
    // Anthropic prompt caching (FASE 8/9) — summed separately from
    // prompt/completion, per the explicit "never mix cache tokens into
    // input_tokens" rule. `cacheRowsSeen` distinguishes "no row ever
    // reported cache data" (report the rate as `null`, not a fake 0)
    // from "reported, and the real rate happens to be 0".
    let cacheCreationTokens = 0
    let cacheReadTokens = 0
    let cacheRowsSeen = 0
    // Catalog/Knowledge/Budun observability (FASE 2 breakdown +
    // FASE 12 Budun columns) — counts of calls where the flag was
    // explicitly computed AND true. Rows that never computed a flag
    // (NULL) simply don't increment either "true" or a "false" counter
    // here — see `flagCalls` below, which tracks the denominator
    // separately so a rate is never computed against the wrong base.
    let catalogAttachedCalls = 0
    let catalogUsedCalls = 0
    let knowledgeRetrievedCalls = 0
    let knowledgeSkippedByRoutingCalls = 0
    let budunUsedCalls = 0
    let budunBlockedCalls = 0
    const routingCounts = { catalog: 0, knowledge: 0, both: 0, neither: 0 }

    // Per-mode + per-model tallies.
    const byMode = {
      auto_reply: { calls: 0, tokens: 0 },
      draft: { calls: 0, tokens: 0 },
    }
    const modelMap = new Map<
      string,
      {
        model: string
        provider: string
        calls: number
        tokens: number
        cacheCreationTokens: number
        cacheReadTokens: number
      }
    >()

    // Zero-filled daily buckets so the chart shows quiet days as gaps,
    // not missing points. Local-day keys, oldest → newest — the same
    // helper every other dashboard chart uses, so day boundaries agree.
    const daily = new Map<string, { date: string; tokens: number; calls: number }>()
    for (const key of lastNDayKeys(days)) {
      daily.set(key, { date: key, tokens: 0, calls: 0 })
    }

    for (const r of rows) {
      promptTokens += r.prompt_tokens
      completionTokens += r.completion_tokens
      totalTokens += r.total_tokens

      if (r.cache_creation_input_tokens !== null || r.cache_read_input_tokens !== null) {
        cacheRowsSeen += 1
        cacheCreationTokens += r.cache_creation_input_tokens ?? 0
        cacheReadTokens += r.cache_read_input_tokens ?? 0
      }

      if (r.catalog_attached === true) catalogAttachedCalls += 1
      if (r.catalog_used === true) catalogUsedCalls += 1
      if (r.knowledge_retrieved === true) knowledgeRetrievedCalls += 1
      if (r.knowledge_skipped_by_routing === true) knowledgeSkippedByRoutingCalls += 1
      if (r.catalog_external_used === true) budunUsedCalls += 1
      if (r.catalog_external_blocked === true) budunBlockedCalls += 1
      if (r.routing_decision) routingCounts[r.routing_decision] += 1

      // `mode` is DB-CHECK-constrained to these two values.
      byMode[r.mode].calls += 1
      byMode[r.mode].tokens += r.total_tokens

      const mk = `${r.provider}:${r.model}`
      const m =
        modelMap.get(mk) ??
        { model: r.model, provider: r.provider, calls: 0, tokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
      m.calls += 1
      m.tokens += r.total_tokens
      m.cacheCreationTokens += r.cache_creation_input_tokens ?? 0
      m.cacheReadTokens += r.cache_read_input_tokens ?? 0
      modelMap.set(mk, m)

      const bucket = daily.get(localDayKey(r.created_at))
      if (bucket) {
        bucket.tokens += r.total_tokens
        bucket.calls += 1
      }
    }

    const byModel = [...modelMap.values()]
      .sort((a, b) => b.tokens - a.tokens)
      .map((m) => ({
        model: m.model,
        provider: m.provider,
        calls: m.calls,
        tokens: m.tokens,
        cache_creation_input_tokens: m.cacheCreationTokens,
        cache_read_input_tokens: m.cacheReadTokens,
      }))

    // Real cache hit rate — tokens actually served from cache over
    // tokens that ever touched caching (read + write) in this window.
    // `null` (never 0) when no row ever reported cache data at all —
    // "not measured yet" must stay distinguishable from "measured, 0%
    // hit rate" (see FASE 12's explicit "no inventar métricas" rule).
    const cacheDenominator = cacheCreationTokens + cacheReadTokens
    const cacheHitRate = cacheRowsSeen > 0 && cacheDenominator > 0 ? cacheReadTokens / cacheDenominator : null

    return NextResponse.json({
      window_days: days,
      truncated,
      totals: {
        calls: rows.length,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        // Anthropic prompt caching (FASE 8/9) — `null` (not 0) when this
        // window has no Anthropic-with-caching rows at all.
        cache_creation_input_tokens: cacheRowsSeen > 0 ? cacheCreationTokens : null,
        cache_read_input_tokens: cacheRowsSeen > 0 ? cacheReadTokens : null,
        cache_hit_rate: cacheHitRate,
      },
      by_mode: byMode,
      by_model: byModel,
      daily: [...daily.values()],
      // Catalog/Budun/Knowledge observability (FASE 12) — aggregated
      // straight from the FASE 2 breakdown + FASE 12 columns already in
      // this same result set; zero extra queries.
      catalog_observability: {
        attached_calls: catalogAttachedCalls,
        used_calls: catalogUsedCalls,
        // Budun-specific — internal-only catalog usage never sets
        // either of these (see catalog/resolver.ts's isBudunProviderKey
        // gate), so both stay 0 for an account with no Budun
        // integration configured, never a false count.
        external_used_calls: budunUsedCalls,
        external_blocked_calls: budunBlockedCalls,
      },
      knowledge_observability: {
        retrieved_calls: knowledgeRetrievedCalls,
        skipped_by_routing_calls: knowledgeSkippedByRoutingCalls,
      },
      routing: routingCounts,
      // No pricing/cost infrastructure exists in this project — tokens
      // are real; cost is honestly reported as unavailable rather than
      // an invented estimate (FASE 12, Regla 3).
      cost_available: false,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
