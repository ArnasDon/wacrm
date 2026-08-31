// ============================================================
// GET /api/v1/pipelines — list pipelines, each with its stages
// (scope: pipelines:read).
//
// Pipelines are settings-class and few per account (the dashboard
// itself treats them that way — see the pipelines page), so — like
// `GET /api/v1/webhooks` — this returns the whole roster rather than
// paginating.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { PIPELINE_SELECT, serializePipeline } from '@/lib/api/v1/pipelines';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:read');

    const { data, error } = await ctx.supabase
      .from('pipelines')
      .select(PIPELINE_SELECT)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[api/v1/pipelines] list error:', error);
      return fail('internal', 'Failed to list pipelines', 500);
    }

    return okList(
      (data ?? []).map((r) => serializePipeline(r as Record<string, unknown>)),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
