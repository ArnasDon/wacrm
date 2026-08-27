// ============================================================
// Shared "move a deal to a pipeline stage" mutation.
//
// Used by both the human-driven Kanban drag (src/app/api/deals/[id]/stage
// route) and the AI action (src/lib/ai/business-actions.ts's `move_deal`)
// so stage-ownership validation and the `is_won` → `status='won'`
// transition live in exactly one place. Callers own auth (role check),
// tenancy resolution, and — separately — dispatching the `deal.stage_changed`
// / `deal.won` webhook events (this helper only mutates; dispatch needs a
// service-role client, which this helper deliberately doesn't assume).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export class MoveDealError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'MoveDealError';
  }
}

export interface MovedDeal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  status: string;
}

export interface MoveDealResult {
  deal: MovedDeal;
  /** True when the target stage is marked "Venta cerrada" (is_won). */
  isWonStage: boolean;
}

/**
 * Move `dealId` to `stageId`, validating the stage belongs to a
 * pipeline in `accountId` (and that the deal itself is in that same
 * pipeline — a deal can't jump pipelines through this call).
 *
 * Keeps `stage_id` and `status` from drifting apart in BOTH directions:
 *  - target stage flagged `is_won` → sets `status = 'won'` + stamps `won_at`;
 *  - target stage NOT `is_won`, and the deal was `won` → reopens it
 *    (`status = 'open'`, clears `won_at`), so a won card dragged back
 *    into the pipeline (or an owner-confirmed `move_deal` on a won deal)
 *    can't leave a "won" deal parked in a pre-sale column. A `lost` deal
 *    is left untouched — reopening it is a deliberate action, not a
 *    side effect of a stage move.
 *
 * Throws {@link MoveDealError}; callers map it to their own response
 * shape (JSON error vs BusinessActionError).
 */
export async function moveDeal(
  db: SupabaseClient,
  accountId: string,
  dealId: string,
  stageId: string
): Promise<MoveDealResult> {
  const { data: stage, error: stageError } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id, is_won, pipelines!inner(account_id)')
    .eq('id', stageId)
    .eq('pipelines.account_id', accountId)
    .maybeSingle();
  if (stageError) throw new MoveDealError(stageError.message, 500);
  if (!stage) throw new MoveDealError('Pipeline stage not found', 404);

  const isWonStage = Boolean(stage.is_won);
  const updates: Record<string, unknown> = { stage_id: stageId };
  if (isWonStage) {
    updates.status = 'won';
    updates.won_at = new Date().toISOString();
  } else {
    // One extra point lookup so the reopen only fires for a deal that
    // was actually `won` — an `open` deal's status/`won_at` are left
    // exactly as they are, and a `lost` deal isn't silently revived.
    const { data: current, error: currentError } = await db
      .from('deals')
      .select('status')
      .eq('id', dealId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (currentError) throw new MoveDealError(currentError.message, 500);
    if (current?.status === 'won') {
      updates.status = 'open';
      updates.won_at = null;
    }
  }

  const { data, error } = await db
    .from('deals')
    .update(updates)
    .eq('id', dealId)
    .eq('account_id', accountId)
    .eq('pipeline_id', stage.pipeline_id)
    .select('id, pipeline_id, stage_id, status')
    .maybeSingle();
  if (error) throw new MoveDealError(error.message, 500);
  if (!data) throw new MoveDealError('Deal not found in this pipeline', 404);

  return { deal: data as MovedDeal, isWonStage };
}

/**
 * Find the "Venta cerrada" stage for `pipelineId`, if the account has
 * flagged one. Shared by every "mark this deal won" caller
 * (`business-actions.ts`'s `mark_deal_won`, the autonomous auto-reply
 * path) so they all land on the same stage a human dragging a card
 * there would — and so `deals.stage_id` and `status` never drift apart
 * for a "won" deal. Returns null when the pipeline has no stage marked
 * `is_won` (callers fall back to a direct status flip, or skip).
 */
export async function findWonStageId(
  db: SupabaseClient,
  accountId: string,
  pipelineId: string
): Promise<string | null> {
  const { data } = await db
    .from('pipeline_stages')
    .select('id, pipelines!inner(account_id)')
    .eq('pipeline_id', pipelineId)
    .eq('pipelines.account_id', accountId)
    .eq('is_won', true)
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
