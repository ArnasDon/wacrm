import type { SupabaseClient } from '@supabase/supabase-js'
import { moveDeal, findWonStageId, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'
import type { LeadTemperature } from '@/types'

export type BusinessAction =
  | 'close_conversation'
  | 'mark_deal_won'
  | 'move_deal'
  | 'set_lead_temperature'

const LEAD_TEMPERATURES: readonly LeadTemperature[] = ['cold', 'warm', 'hot']

export class BusinessActionError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function confirmationPhrase(action: BusinessAction, targetId: string) {
  return `CONFIRM:${action}:${targetId}`
}

export async function executeBusinessAction(args: {
  db: SupabaseClient; accountId: string; userId: string; action: BusinessAction;
  targetId: string; stageId?: string; temperature?: string
}) {
  const { db, accountId, userId, action, targetId, stageId, temperature } = args
  let result: Record<string, unknown>

  // Webhook dispatch always goes through its own service-role client —
  // `db` here is the caller's RLS-scoped session client (correct for the
  // mutation itself), but delivery bookkeeping (webhook_deliveries,
  // webhook_endpoints.failure_count) requires service_role per RLS.
  const webhookDb = supabaseAdmin()

  if (action === 'close_conversation') {
    const { data, error } = await db.from('conversations').update({ status: 'closed' })
      .eq('id', targetId).eq('account_id', accountId).select('id, status').maybeSingle()
    if (error) throw new BusinessActionError(error.message, 500)
    if (!data) throw new BusinessActionError('Conversation not found', 404)
    result = data
    void dispatchWebhookEvent(webhookDb, accountId, 'conversation.closed', {
      conversation_id: data.id, closed_by: 'ai_action',
    })
  } else if (action === 'mark_deal_won') {
    // Prefer moving to the pipeline's "Venta cerrada" stage (migration
    // 051) — same operation a human dragging the card there triggers —
    // so status and stage_id never drift apart. Falls back to a direct
    // status flip only for pipelines that haven't flagged a won stage.
    const { data: deal, error: dealError } = await db.from('deals')
      .select('id, pipeline_id').eq('id', targetId).eq('account_id', accountId).maybeSingle()
    if (dealError) throw new BusinessActionError(dealError.message, 500)
    if (!deal) throw new BusinessActionError('Deal not found', 404)

    const wonStageId = await findWonStageId(db, accountId, deal.pipeline_id)
    if (wonStageId) {
      let moved
      try {
        moved = await moveDeal(db, accountId, targetId, wonStageId)
      } catch (err) {
        if (err instanceof MoveDealError) throw new BusinessActionError(err.message, err.status)
        throw err
      }
      result = { ...moved.deal }
    } else {
      const { data, error } = await db.from('deals').update({ status: 'won' })
        .eq('id', targetId).eq('account_id', accountId)
        .select('id, pipeline_id, stage_id, status').maybeSingle()
      if (error) throw new BusinessActionError(error.message, 500)
      if (!data) throw new BusinessActionError('Deal not found', 404)
      result = data
    }
    void dispatchWebhookEvent(webhookDb, accountId, 'deal.won', {
      deal_id: targetId, source: 'ai_action',
    })
  } else if (action === 'move_deal') {
    if (!stageId) throw new BusinessActionError('stageId is required')
    let moved
    try {
      moved = await moveDeal(db, accountId, targetId, stageId)
    } catch (err) {
      if (err instanceof MoveDealError) throw new BusinessActionError(err.message, err.status)
      throw err
    }
    result = { ...moved.deal }
    void dispatchWebhookEvent(webhookDb, accountId, 'deal.stage_changed', {
      deal_id: moved.deal.id, pipeline_id: moved.deal.pipeline_id, stage_id: moved.deal.stage_id, source: 'ai_action',
    })
    if (moved.isWonStage) {
      void dispatchWebhookEvent(webhookDb, accountId, 'deal.won', {
        deal_id: moved.deal.id, source: 'ai_action',
      })
    }
  } else if (action === 'set_lead_temperature') {
    // targetId is a contact_id for this action (every other action
    // targets a conversation or deal) — callers must know the right id
    // shape per action, same as move_deal already requires a stageId.
    if (!temperature || !LEAD_TEMPERATURES.includes(temperature as LeadTemperature)) {
      throw new BusinessActionError('temperature must be one of cold, warm, hot')
    }
    const { data, error } = await db.from('contacts')
      .update({ lead_temperature: temperature, updated_at: new Date().toISOString() })
      .eq('id', targetId).eq('account_id', accountId)
      .select('id, lead_temperature').maybeSingle()
    if (error) throw new BusinessActionError(error.message, 500)
    if (!data) throw new BusinessActionError('Contact not found', 404)
    result = data
    void dispatchWebhookEvent(webhookDb, accountId, 'contact.lead_temperature_changed', {
      contact_id: data.id, lead_temperature: data.lead_temperature,
    })
  } else {
    throw new BusinessActionError(`Unsupported action: ${action as string}`)
  }

  const { error: auditError } = await db.from('ai_action_log').insert({
    account_id: accountId, actor_user_id: userId, action, target_id: targetId,
    input: {
      ...(stageId ? { stageId } : {}),
      ...(temperature ? { temperature } : {}),
    },
    result,
  })
  if (auditError) throw new BusinessActionError('Action completed but audit logging failed', 500)
  return result
}
