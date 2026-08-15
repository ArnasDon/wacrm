import type { SupabaseClient } from '@supabase/supabase-js'

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

  if (action === 'close_conversation') {
    const { data, error } = await db.from('conversations').update({ status: 'closed' })
      .eq('id', targetId).eq('account_id', accountId).select('id, status').maybeSingle()
    if (error) throw new BusinessActionError(error.message, 500)
    if (!data) throw new BusinessActionError('Conversation not found', 404)
    result = data
  } else if (action === 'mark_deal_won') {
    const { data, error } = await db.from('deals').update({ status: 'won' })
      .eq('id', targetId).eq('account_id', accountId).select('id, status').maybeSingle()
    if (error) throw new BusinessActionError(error.message, 500)
    if (!data) throw new BusinessActionError('Deal not found', 404)
    result = data
  } else {
    if (!stageId) throw new BusinessActionError('stageId is required')
    const { data: stage, error: stageError } = await db.from('pipeline_stages')
      .select('id, pipeline_id, pipelines!inner(account_id)').eq('id', stageId)
      .eq('pipelines.account_id', accountId).maybeSingle()
    if (stageError) throw new BusinessActionError(stageError.message, 500)
    if (!stage) throw new BusinessActionError('Pipeline stage not found', 404)
    const { data, error } = await db.from('deals').update({ stage_id: stageId })
      .eq('id', targetId).eq('account_id', accountId).eq('pipeline_id', stage.pipeline_id)
      .select('id, pipeline_id, stage_id').maybeSingle()
    if (error) throw new BusinessActionError(error.message, 500)
    if (!data) throw new BusinessActionError('Deal not found in this pipeline', 404)
    result = data
  }

  const { error: auditError } = await db.from('ai_action_log').insert({
    account_id: accountId, actor_user_id: userId, action, target_id: targetId,
    input: stageId ? { stageId } : {}, result,
  })
  if (auditError) throw new BusinessActionError('Action completed but audit logging failed', 500)
  return result
}

