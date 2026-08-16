import type { SupabaseClient } from '@supabase/supabase-js'
import { moveDeal, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'

export type BusinessAction = 'close_conversation' | 'mark_deal_won' | 'move_deal'

export class BusinessActionError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function confirmationPhrase(action: BusinessAction, targetId: string) {
  return `CONFIRM:${action}:${targetId}`
}

export async function executeBusinessAction(args: {
  db: SupabaseClient; accountId: string; userId: string; action: BusinessAction;
  targetId: string; stageId?: string
}) {
  const { db, accountId, userId, action, targetId, stageId } = args
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
    const { data, error } = await db.from('deals').update({ status: 'won' })
      .eq('id', targetId).eq('account_id', accountId).select('id, status').maybeSingle()
    if (error) throw new BusinessActionError(error.message, 500)
    if (!data) throw new BusinessActionError('Deal not found', 404)
    result = data
    void dispatchWebhookEvent(webhookDb, accountId, 'deal.won', {
      deal_id: data.id, source: 'ai_action',
    })
  } else {
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
  }

  const { error: auditError } = await db.from('ai_action_log').insert({
    account_id: accountId, actor_user_id: userId, action, target_id: targetId,
    input: stageId ? { stageId } : {}, result,
  })
  if (auditError) throw new BusinessActionError('Action completed but audit logging failed', 500)
  return result
}

