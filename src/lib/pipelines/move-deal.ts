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
 * pipeline — a deal can't jump pipelines through this call). When the
 * target stage is flagged `is_won`, also sets `deals.status = 'won'`.
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
  if (isWonStage) updates.status = 'won';

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
