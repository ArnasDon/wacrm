// ============================================================
// GET    /api/v1/deals/{id} — read a deal    (scope: deals:read)
// PATCH  /api/v1/deals/{id} — update a deal   (scope: deals:write)
// DELETE /api/v1/deals/{id} — delete a deal   (scope: deals:write)
//
// All account-scoped: a deal belonging to another account returns
// `404` (never 403 — don't reveal it exists elsewhere). `PATCH`
// updates only the fields present in the body. `stage_id` may move
// the deal between stages of its *own* pipeline; `pipeline_id` is
// immutable after creation (delete and recreate the deal instead).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  DealError,
  getDealById,
  parseDealFields,
  assertStageInPipeline,
  assertContactInAccount,
  assertAssigneeInAccount,
} from '@/lib/api/v1/deals';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { id } = await params;
    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!deal) return fail('not_found', 'Deal not found', 404);
    return ok(deal);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const existing = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Deal not found', 404);

    if ('pipeline_id' in body && body.pipeline_id !== existing.pipeline_id) {
      return fail(
        'bad_request',
        "'pipeline_id' cannot be changed after creation — delete and recreate the deal instead",
        400
      );
    }

    const fields = parseDealFields(body, { requireTitle: false });

    let stageId: string | undefined;
    if ('stage_id' in body) {
      stageId = typeof body.stage_id === 'string' ? body.stage_id : '';
      if (!stageId) {
        return fail('bad_request', "'stage_id' must be a string", 400);
      }
      await assertStageInPipeline(ctx.supabase, existing.pipeline_id, stageId);
    }

    if (fields.contact_id) {
      await assertContactInAccount(ctx.supabase, ctx.accountId, fields.contact_id);
    }
    if (fields.assigned_to) {
      await assertAssigneeInAccount(ctx.supabase, ctx.accountId, fields.assigned_to);
    }

    const updates: Record<string, unknown> = { ...fields };
    if (stageId) updates.stage_id = stageId;

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await ctx.supabase
        .from('deals')
        .update(updates)
        .eq('id', id)
        .eq('account_id', ctx.accountId);
      if (error) {
        console.error('[api/v1/deals] update error:', error);
        return fail('internal', 'Failed to update deal', 500);
      }
    }

    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    return ok(deal);
  } catch (err) {
    if (err instanceof DealError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;

    const existing = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Deal not found', 404);

    const { error } = await ctx.supabase
      .from('deals')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[api/v1/deals] delete error:', error);
      return fail('internal', 'Failed to delete deal', 500);
    }

    return ok({ id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
