import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export interface MoveDealStageArgs {
  accountId: string
  dealId: string
  toStageId: string
  source: 'automation' | 'ai'
  /** Free-text reason, shown in ai_pipeline_moves when source === 'ai'. */
  reason?: string
}

export interface MoveDealStageResult {
  moved: boolean
  fromStageId?: string
  toStageId?: string
  contactId?: string | null
  conversationId?: string | null
  detail: string
}

/**
 * Single, tenant-safe entry point for changing a deal's stage. Used by
 * the `move_deal_stage` automation step and the AI agent.
 *
 * Deliberately does NOT fire the `deal_stage_changed` automation trigger
 * itself — doing so would create a circular import with
 * src/lib/automations/engine.ts. Callers fire that trigger themselves
 * after a successful move.
 */
export async function moveDealStage(args: MoveDealStageArgs): Promise<MoveDealStageResult> {
  const { accountId, dealId, toStageId, source, reason } = args
  const db = supabaseAdmin()

  const { data: deal, error: dealErr } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id, contact_id, conversation_id')
    .eq('id', dealId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (dealErr || !deal) {
    return { moved: false, detail: 'deal not found in this account' }
  }

  const { data: stage, error: stageErr } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('id', toStageId)
    .eq('pipeline_id', deal.pipeline_id)
    .maybeSingle()
  if (stageErr || !stage) {
    return { moved: false, detail: "target stage is not in the deal's pipeline" }
  }

  const fromStageId = deal.stage_id as string
  if (fromStageId === toStageId) {
    return {
      moved: false,
      fromStageId,
      toStageId,
      contactId: deal.contact_id as string | null,
      conversationId: deal.conversation_id as string | null,
      detail: 'already in target stage',
    }
  }

  const { error: updErr } = await db
    .from('deals')
    .update({ stage_id: toStageId, updated_at: new Date().toISOString() })
    .eq('id', dealId)
    .eq('account_id', accountId)
  if (updErr) {
    return { moved: false, detail: `update failed: ${updErr.message}` }
  }

  if (source === 'ai') {
    await db.from('ai_pipeline_moves').insert({
      account_id: accountId,
      deal_id: dealId,
      conversation_id: deal.conversation_id ?? null,
      from_stage_id: fromStageId,
      to_stage_id: toStageId,
      reason: reason ?? null,
    })
  }

  await dispatchWebhookEvent(db, accountId, 'deal.stage_changed', {
    deal_id: dealId,
    pipeline_id: deal.pipeline_id,
    from_stage_id: fromStageId,
    to_stage_id: toStageId,
    source,
  })

  return {
    moved: true,
    fromStageId,
    toStageId,
    contactId: deal.contact_id as string | null,
    conversationId: deal.conversation_id as string | null,
    detail: `moved from ${fromStageId} to ${toStageId}`,
  }
}
