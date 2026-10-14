import { aiRoute } from '@/lib/ai/local-route';
import { queryRows } from '@/lib/db/rows';
import {
  daysAgoStart,
  lastNDayKeys,
  localDayKey,
} from '@/lib/dashboard/date-utils';

// Rows are aggregated in-process over a bounded window. An active
// account writes a handful of rows per conversation, so 30 days sits
// comfortably under this cap; we surface `truncated` when it doesn't so
// the UI can say "showing a partial window" rather than under-reporting
// silently.
const MAX_ROWS = 10_000;
const DEFAULT_WINDOW_DAYS = 30;

interface UsageRow {
  created_at: string;
  mode: 'auto_reply' | 'draft';
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
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
  return aiRoute(request, 'admin', async ({ db, accountId }) => {
    const url = new URL(request.url);
    const rawDays = Number(url.searchParams.get('days'));
    // Guard `>= 1`, not just `isFinite`: a missing/blank param is
    // Number(null)/Number('') === 0, which is finite — without the lower
    // bound the default would never apply and the window would collapse
    // to a single day.
    const days =
      Number.isFinite(rawDays) && rawDays >= 1
        ? Math.min(90, Math.floor(rawDays))
        : DEFAULT_WINDOW_DAYS;

    // Align the query cutoff to the START of the oldest local day we'll
    // chart (not a rolling `now - N*24h` instant). Otherwise rows in the
    // oldest partial day would be counted in the totals but fall outside
    // every daily bucket, so the chart's bars wouldn't sum to the
    // headline total. Local-day boundaries match every other dashboard
    // chart (see lib/dashboard/date-utils).
    const since = daysAgoStart(days - 1);

    const data = await queryRows<UsageRow>(
      db,
      'SELECT created_at,mode,provider,model,prompt_tokens,completion_tokens,total_tokens FROM public.ai_usage_log WHERE account_id=$1 AND created_at>=$2 ORDER BY created_at DESC,id DESC LIMIT $3',
      [accountId, since.toISOString(), MAX_ROWS + 1]
    );
    const all = (data ?? []) as UsageRow[];
    const truncated = all.length > MAX_ROWS;
    const rows = truncated ? all.slice(0, MAX_ROWS) : all;

    // Totals.
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    // Per-mode + per-model tallies.
    const byMode = {
      auto_reply: { calls: 0, tokens: 0 },
      draft: { calls: 0, tokens: 0 },
    };
    const modelMap = new Map<
      string,
      { model: string; provider: string; calls: number; tokens: number }
    >();

    // Zero-filled daily buckets so the chart shows quiet days as gaps,
    // not missing points. Local-day keys, oldest → newest — the same
    // helper every other dashboard chart uses, so day boundaries agree.
    const daily = new Map<
      string,
      { date: string; tokens: number; calls: number }
    >();
    for (const key of lastNDayKeys(days)) {
      daily.set(key, { date: key, tokens: 0, calls: 0 });
    }

    for (const r of rows) {
      promptTokens += r.prompt_tokens;
      completionTokens += r.completion_tokens;
      totalTokens += r.total_tokens;

      // `mode` is DB-CHECK-constrained to these two values.
      byMode[r.mode].calls += 1;
      byMode[r.mode].tokens += r.total_tokens;

      const mk = `${r.provider}:${r.model}`;
      const m = modelMap.get(mk) ?? {
        model: r.model,
        provider: r.provider,
        calls: 0,
        tokens: 0,
      };
      m.calls += 1;
      m.tokens += r.total_tokens;
      modelMap.set(mk, m);

      const bucket = daily.get(localDayKey(r.created_at));
      if (bucket) {
        bucket.tokens += r.total_tokens;
        bucket.calls += 1;
      }
    }

    const byModel = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens);

    return {
      window_days: days,
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
    };
  });
}
