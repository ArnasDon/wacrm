// ============================================================
// GET  /api/v1/deals — list deals (scope: deals:read)
// POST /api/v1/deals — create a deal (scope: deals:write)
//
// List is keyset-paginated (see src/lib/api/v1/pagination.ts) and
// supports `?pipeline_id=`, `?stage_id=`, `?status=`, `?contact_id=`,
// and `?assigned_to=` filters. Create requires `pipeline_id` +
// `stage_id` (the stage must belong to the pipeline) and `title`;
// `contact_id`/`assigned_to`, when given, must resolve inside this
// account — see src/lib/api/v1/deals.ts for the shared validation.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import {
  DealError,
  serializeDeal,
  parseDealFields,
  assertPipelineAndStage,
  assertContactInAccount,
  assertAssigneeInAccount,
  getAccountDefaultCurrency,
  getDealById,
} from '@/lib/api/v1/deals';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get('pipeline_id');
    const stageId = url.searchParams.get('stage_id');
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');
    const assignedTo = url.searchParams.get('assigned_to');

    let query = ctx.supabase
      .from('deals')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (pipelineId) query = query.eq('pipeline_id', pipelineId);
    if (stageId) query = query.eq('stage_id', stageId);
    if (status) query = query.eq('status', status);
    if (contactId) query = query.eq('contact_id', contactId);
    if (assignedTo) query = query.eq('assigned_to', assignedTo);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/deals] list error:', error);
      return fail('internal', 'Failed to list deals', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeDeal(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const pipelineId = typeof body.pipeline_id === 'string' ? body.pipeline_id : '';
    const stageId = typeof body.stage_id === 'string' ? body.stage_id : '';
    if (!pipelineId || !stageId) {
      return fail('bad_request', "'pipeline_id' and 'stage_id' are required", 400);
    }

    const fields = parseDealFields(body, { requireTitle: true });

    await assertPipelineAndStage(ctx.supabase, ctx.accountId, pipelineId, stageId);
    if (fields.contact_id) {
      await assertContactInAccount(ctx.supabase, ctx.accountId, fields.contact_id);
    }
    if (fields.assigned_to) {
      await assertAssigneeInAccount(ctx.supabase, ctx.accountId, fields.assigned_to);
    }

    const currency =
      fields.currency ?? (await getAccountDefaultCurrency(ctx.supabase, ctx.accountId));
    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    const { data: created, error } = await ctx.supabase
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: auditUserId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: fields.title,
        value: fields.value ?? 0,
        currency,
        contact_id: fields.contact_id ?? null,
        assigned_to: fields.assigned_to ?? null,
        notes: fields.notes ?? null,
        expected_close_date: fields.expected_close_date ?? null,
        status: fields.status ?? 'open',
      })
      .select('id')
      .single();

    if (error || !created) {
      console.error('[api/v1/deals] create error:', error);
      return fail('internal', 'Failed to create deal', 500);
    }

    const deal = await getDealById(ctx.supabase, ctx.accountId, created.id as string);
    return ok(deal, 201);
  } catch (err) {
    if (err instanceof DealError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
