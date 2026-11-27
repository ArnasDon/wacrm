// ============================================================
// GET  /api/v1/flows — list flows           (scope: flows:read)
// POST /api/v1/flows — import a flow (JSON) (scope: flows:write)
//
// POST takes the portable flow document (same file the dashboard's
// "Export JSON" button produces — see src/lib/flows/import.ts) and
// creates a DRAFT flow. The response carries `issues`: the activation
// validator's report. Activate it with
// POST /api/v1/flows/{id}/activate once `issues` has no errors.
//
// Tags referenced by `tag_name` on set_tag nodes are created when
// missing — acceptable here because creating an API key is already
// gated to admin+ (see src/lib/api-keys/scopes.ts).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseFlowImport } from '@/lib/flows/import';
import {
  createFlowFromImport,
  FlowImportError,
  resolveAuthorId,
} from '@/lib/flows/import-server';

const FLOW_COLUMNS =
  'id, name, description, status, trigger_type, trigger_config, entry_node_id, execution_count, last_executed_at, created_at, updated_at';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'flows:read');
    const { data, error } = await ctx.supabase
      .from('flows')
      .select(FLOW_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[api/v1/flows] list error:', error);
      return fail('internal', 'Failed to list flows', 500);
    }
    return okList(data ?? [], null);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'flows:write');

    const body = await request.json().catch(() => null);
    const parsed = parseFlowImport(body);
    if (!parsed.ok) {
      return fail('bad_request', parsed.errors.join(' '), 400);
    }

    try {
      const authorId = await resolveAuthorId(ctx.supabase, ctx.accountId, ctx.createdBy);
      const { flow, issues } = await createFlowFromImport(ctx.supabase, {
        accountId: ctx.accountId,
        authorId,
        flow: parsed.value,
        canCreateTags: true,
      });
      return ok({ ...flow, issues }, 201);
    } catch (err) {
      if (err instanceof FlowImportError) {
        return fail(err.status === 403 ? 'forbidden' : 'bad_request', err.message, err.status);
      }
      throw err;
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
