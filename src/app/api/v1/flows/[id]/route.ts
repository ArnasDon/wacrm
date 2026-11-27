// ============================================================
// GET /api/v1/flows/{id} — export one flow as portable JSON
//                          (scope: flows:read)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { buildFlowExport } from '@/lib/flows/import';
import { loadFlowExport } from '@/lib/flows/import-server';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, 'flows:read');
    const { id } = await context.params;
    const loaded = await loadFlowExport(ctx.supabase, ctx.accountId, id);
    if (!loaded) return fail('not_found', 'Flow not found', 404);
    return ok(buildFlowExport(loaded.flow, loaded.nodes, loaded.tagNameById));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
