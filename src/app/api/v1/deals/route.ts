// ============================================================
// /api/v1/deals — list and create deals (migration 908).
//
// GET  (scope: deals:read)  — keyset-paginated list. Filters:
//        `?pipeline_id=`, `?stage_id=`, `?contact_id=`, `?status=`
//        (open|won|lost).
// POST (scope: deals:write) — create a deal via `createDeal`, the
//        single server-side birthplace of deals: it validates the
//        pipeline belongs to the account and the stage belongs to
//        the pipeline, and stamps BRL (moeda fixa desde o #66). API-created
//        deals get `source: 'manual'` and no channel (the channel
//        column means "which number the customer arrived through",
//        which an API call doesn't know).
//
// ⚠️ `stage_id` is REQUIRED here even though `createDeal` can fall
// back to the lowest-position stage. The entry stage is an explicit
// product decision (this account's position 0 is a parking lane,
// not the entry) — resolving by position would dump leads there,
// and a deal parked in that stage blocks restructuring it (the
// stage FK is NO ACTION).
//
// ⚠️ One card per contact (migration 911): the product model is a
// single deal that TRANSITS between pipelines. The 911 index only
// backstops `source: 'channel'` races, so this route re-states the
// semantic rule the router applies — otherwise the API would be the
// one door that mints duplicates, and the automations' "most recent
// deal" targeting would silently switch cards.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import {
  ok,
  okList,
  fail,
  badRequest,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { DEAL_STATUSES, serializeDeal } from '@/lib/api/v1/deals';
import { drenarEventosDeFunil } from '@/lib/automations/drain-events';
import { createDeal } from '@/lib/deals/create-deal';
import { ehUuid } from '@/lib/tasks/validar';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get('pipeline_id');
    const stageId = url.searchParams.get('stage_id');
    const contactId = url.searchParams.get('contact_id');
    const status = url.searchParams.get('status');

    for (const [name, value] of [
      ['pipeline_id', pipelineId],
      ['stage_id', stageId],
      ['contact_id', contactId],
    ] as const) {
      if (value && !ehUuid(value)) throw badRequest(`'${name}' must be a UUID`);
    }
    if (status && !DEAL_STATUSES.includes(status as (typeof DEAL_STATUSES)[number])) {
      throw badRequest(`'status' must be one of: ${DEAL_STATUSES.join(', ')}`);
    }

    let query = ctx.supabase
      .from('deals')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (pipelineId) query = query.eq('pipeline_id', pipelineId);
    if (stageId) query = query.eq('stage_id', stageId);
    if (contactId) query = query.eq('contact_id', contactId);
    if (status) query = query.eq('status', status);

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
      (data ?? []) as Array<{ created_at: string; id: string }>,
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

    const body = (await request.json().catch(() => null)) as {
      contact_id?: unknown;
      pipeline_id?: unknown;
      stage_id?: unknown;
      title?: unknown;
      value?: unknown;
    } | null;
    if (!body) throw badRequest('Invalid JSON body');

    if (!ehUuid(body.contact_id)) throw badRequest("'contact_id' is required");
    if (!ehUuid(body.pipeline_id)) throw badRequest("'pipeline_id' is required");
    // Required — see the header note. `GET /api/v1/pipelines` lists the
    // valid stages.
    if (!ehUuid(body.stage_id)) {
      throw badRequest(
        "'stage_id' is required — pick one from GET /api/v1/pipelines"
      );
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) throw badRequest("'title' is required");

    let value: number | undefined;
    if (body.value !== undefined && body.value !== null) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0) {
        throw badRequest("'value' must be a non-negative number");
      }
      value = body.value;
    }

    // `createDeal` validates pipeline/stage tenancy but takes the
    // contact on trust — the router already knows its contact. An API
    // caller doesn't, so check it here. A DB error is NOT "not found":
    // a 404 here would tell the integrator to recreate the contact.
    const { data: contato, error: contatoErr } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', body.contact_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contatoErr) {
      console.error('[api/v1/deals] contact lookup error:', contatoErr);
      return fail('internal', 'Failed to verify the contact', 500);
    }
    if (!contato) return fail('not_found', 'Contact not found', 404);

    // One card per contact — same breadth as the router: open or
    // closed, any pipeline, any source.
    const { data: existente, error: existenteErr } = await ctx.supabase
      .from('deals')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', body.contact_id)
      .limit(1)
      .maybeSingle();
    if (existenteErr) {
      console.error('[api/v1/deals] duplicate check error:', existenteErr);
      return fail('internal', 'Failed to check for an existing deal', 500);
    }
    if (existente) {
      return fail(
        'contact_already_has_deal',
        `This contact already has a deal (${existente.id}); move it with PATCH /api/v1/deals/{id} instead`,
        409
      );
    }

    const ownerUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    const result = await createDeal({
      db: ctx.supabase,
      accountId: ctx.accountId,
      ownerUserId,
      contactId: body.contact_id,
      pipelineId: body.pipeline_id,
      stageId: body.stage_id,
      title,
      // O título veio escrito no corpo: é escolha de quem chamou, e o
      // gatilho da 1007 não o troca depois pelo nome da ficha.
      tituloFixadoEm: new Date().toISOString(),
      value,
      source: 'manual',
    });

    if (!result.ok) {
      if (result.code === 'pipeline_not_found') {
        return fail('not_found', result.message, 404);
      }
      if (result.code === 'stage_not_found' || result.code === 'no_stage') {
        return fail(result.code, result.message, 400);
      }
      console.error('[api/v1/deals] create error:', result.message);
      return fail('internal', 'Failed to create deal', 500);
    }
    if (!result.deal) {
      // Only reachable on the router's unique-index collision, which
      // requires `source: 'channel'` — but never answer 5xx for a row
      // that exists: HTTP clients retry 5xx, and a retry here would be
      // a duplicate attempt.
      return fail(
        'contact_already_has_deal',
        'This contact already has a deal; move it with PATCH /api/v1/deals/{id} instead',
        409
      );
    }

    // Wake the automation queue now instead of waiting for the 15-min
    // cron — same optimization the dashboard applies after a move.
    // Fire-and-forget: the queue + cron are the correctness net.
    void drenarEventosDeFunil().catch(() => {});

    return ok(serializeDeal(result.deal), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
