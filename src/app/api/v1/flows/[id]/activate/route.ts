// ============================================================
// POST /api/v1/flows/{id}/activate — set a flow's status
//                                    (scope: flows:write)
//
// Body: { "status": "active" | "draft" | "archived" }
// Going active runs the same validator as the dashboard and refuses
// (422) while any error-severity issue remains.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { validateFlowForActivation } from '@/lib/flows/validate';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, 'flows:write');
    const { id } = await context.params;

    const body = (await request.json().catch(() => null)) as { status?: string } | null;
    const status = body?.status;
    if (!status || !['draft', 'active', 'archived'].includes(status)) {
      return fail('bad_request', "'status' must be 'draft', 'active' or 'archived'", 400);
    }

    const { data: flow } = await ctx.supabase
      .from('flows')
      .select('id, name, trigger_type, trigger_config, entry_node_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!flow) return fail('not_found', 'Flow not found', 404);

    if (status === 'active') {
      const { data: nodes } = await ctx.supabase
        .from('flow_nodes')
        .select('node_key, node_type, config')
        .eq('flow_id', id);
      const issues = validateFlowForActivation(
        flow as Parameters<typeof validateFlowForActivation>[0],
        (nodes ?? []) as Parameters<typeof validateFlowForActivation>[1],
      );
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        return fail(
          'validation_failed',
          `Cannot activate: ${errors.map((e) => e.message).join(' ')}`,
          422,
        );
      }
    }

    const { data: updated, error } = await ctx.supabase
      .from('flows')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id, name, status, updated_at')
      .maybeSingle();
    if (error) {
      console.error('[api/v1/flows/activate] error:', error);
      return fail('internal', 'Failed to update flow', 500);
    }
    return ok(updated);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
