// ============================================================
// GET /api/v1/pipelines/{id} — read one pipeline + its stages
// (scope: pipelines:read). Account-scoped: a foreign id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { PIPELINE_SELECT, serializePipeline } from '@/lib/api/v1/pipelines';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('pipelines')
      .select(PIPELINE_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/pipelines] read error:', error);
      return fail('internal', 'Failed to read pipeline', 500);
    }
    if (!data) return fail('not_found', 'Pipeline not found', 404);

    return ok(serializePipeline(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
