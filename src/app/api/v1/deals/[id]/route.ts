// ============================================================
// /api/v1/deals/{id} — read and update a deal.
//
// GET   (scope: deals:read)
// PATCH (scope: deals:write) — update `title`, `value`, `status`,
//        and/or move the deal:
//          - `stage_id` alone moves within the current pipeline
//            (the stage must belong to it);
//          - `pipeline_id` + `stage_id` together transfer to
//            another pipeline.
//
// ⚠️ A cross-pipeline transfer MUST be a single UPDATE with both
// columns (the audit trail — migration 912 — writes one event per
// UPDATE; two updates would record the lead leaving and coming
// back, a story that never happened). That's why `pipeline_id`
// without `stage_id` is rejected: the current stage belongs to the
// old pipeline, and the composite FK would reject the pair anyway.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { DEAL_STATUSES, serializeDeal } from '@/lib/api/v1/deals';
import { drenarEventosDeFunil } from '@/lib/automations/drain-events';
import { ehUuid } from '@/lib/tasks/validar';
import { escritaDoTituloManual } from '@/lib/deals/titulo-do-card';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('deals')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error || !data) return fail('not_found', 'Deal not found', 404);
    return ok(serializeDeal(data as Record<string, unknown>));
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

    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      value?: unknown;
      status?: unknown;
      stage_id?: unknown;
      pipeline_id?: unknown;
    } | null;
    if (!body) throw badRequest('Invalid JSON body');

    const { data: atual, error: readErr } = await ctx.supabase
      .from('deals')
      .select('id, pipeline_id, stage_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (readErr || !atual) return fail('not_found', 'Deal not found', 404);

    const update: Record<string, unknown> = {};

    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) throw badRequest("'title' must be a non-empty string");
      // Título escrito no corpo é escolha de quem chamou, e FIXA o card
      // (1007): o gatilho que mantém o título igual ao nome da ficha não o
      // troca mais. `antes = null` porque aqui não há foto de tela a
      // comparar — quem mandou o campo quis mandá-lo.
      Object.assign(update, escritaDoTituloManual(null, title, new Date().toISOString()));
    }

    if (body.value !== undefined) {
      if (
        typeof body.value !== 'number' ||
        !Number.isFinite(body.value) ||
        body.value < 0
      ) {
        throw badRequest("'value' must be a non-negative number");
      }
      update.value = body.value;
    }

    if (body.status !== undefined) {
      if (
        typeof body.status !== 'string' ||
        !DEAL_STATUSES.includes(body.status as (typeof DEAL_STATUSES)[number])
      ) {
        throw badRequest(`'status' must be one of: ${DEAL_STATUSES.join(', ')}`);
      }
      update.status = body.status;
    }

    const movePipeline = body.pipeline_id !== undefined;
    const moveStage = body.stage_id !== undefined;

    if (movePipeline && !ehUuid(body.pipeline_id)) {
      throw badRequest("'pipeline_id' must be a UUID");
    }
    if (moveStage && !ehUuid(body.stage_id)) {
      throw badRequest("'stage_id' must be a UUID");
    }

    if (movePipeline && (body.pipeline_id as string) !== atual.pipeline_id) {
      if (!moveStage) {
        throw badRequest(
          "moving to another pipeline requires 'stage_id' (a stage of the target pipeline)"
        );
      }
      // Target pipeline must be this account's. A DB error is not
      // "not found" — don't invite the caller to conclude the
      // pipeline vanished.
      const { data: funil, error: funilErr } = await ctx.supabase
        .from('pipelines')
        .select('id')
        .eq('id', body.pipeline_id as string)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (funilErr) {
        console.error('[api/v1/deals/:id] pipeline lookup error:', funilErr);
        return fail('internal', 'Failed to verify the pipeline', 500);
      }
      if (!funil) return fail('not_found', 'Pipeline not found', 404);
      update.pipeline_id = body.pipeline_id;
    }

    if (moveStage) {
      // The stage must belong to whichever pipeline the deal will be
      // in after this update.
      const targetPipeline = (update.pipeline_id as string) ?? atual.pipeline_id;
      const { data: etapa, error: etapaErr } = await ctx.supabase
        .from('pipeline_stages')
        .select('id')
        .eq('id', body.stage_id as string)
        .eq('pipeline_id', targetPipeline)
        .maybeSingle();
      if (etapaErr) {
        console.error('[api/v1/deals/:id] stage lookup error:', etapaErr);
        return fail('internal', 'Failed to verify the stage', 500);
      }
      if (!etapa) {
        return fail(
          'stage_not_found',
          'The stage does not belong to the target pipeline',
          400
        );
      }
      update.stage_id = body.stage_id;
    }

    if (Object.keys(update).length === 0) {
      throw badRequest('Nothing to update');
    }

    const { data: depois, error } = await ctx.supabase
      .from('deals')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();

    if (error || !depois) {
      console.error('[api/v1/deals/:id] update error:', error);
      return fail('internal', 'Failed to update deal', 500);
    }

    // A stage/pipeline/status change enqueues funnel events (933
    // trigger); wake the drain now instead of waiting for the 15-min
    // cron — same optimization the dashboard applies after a move.
    if (update.stage_id || update.pipeline_id || update.status) {
      void drenarEventosDeFunil().catch(() => {});
    }

    return ok(serializeDeal(depois as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
