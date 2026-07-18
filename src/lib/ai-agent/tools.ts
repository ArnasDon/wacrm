import type { SupabaseClient } from '@supabase/supabase-js'

import type { AiAgentContext } from './context'
import type { AiAgentDecision, DealAction } from './decision'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'

export interface ExecuteAiAgentDecisionInput {
  db: SupabaseClient
  accountId: string
  aiAgentId: string
  conversationId: string
  decision: AiAgentDecision
  context: AiAgentContext
  assertCanRun?: () => Promise<void>
}

export interface AiAgentToolResult {
  replyMessageId?: string
  whatsappMessageId?: string
  dealAction?:
    | { type: 'none' }
    | { type: 'created'; dealId: string }
    | { type: 'moved'; dealId: string; stageId: string }
    | { type: 'updated'; dealId: string }
  handoff?: { status: 'handoff' }
}

export class AiAgentToolError extends Error {
  readonly code:
    | 'missing_contact'
    | 'invalid_pipeline'
    | 'invalid_stage'
    | 'invalid_deal'
    | 'duplicate_deal'
    | 'deal_write_failed'
    | 'handoff_failed'
    | 'reply_failed'

  constructor(code: AiAgentToolError['code'], message: string) {
    super(message)
    this.name = 'AiAgentToolError'
    this.code = code
  }
}

export async function executeAiAgentDecision(input: ExecuteAiAgentDecisionInput): Promise<AiAgentToolResult> {
  if (input.decision.action === 'handoff') {
    const now = new Date().toISOString()
    await input.assertCanRun?.()
    try {
      const { error: conversationError } = await input.db
        .from('conversations')
        .update({ status: 'open', updated_at: now })
        .eq('account_id', input.accountId)
        .eq('id', input.conversationId)
      if (conversationError) throw conversationError
      return { handoff: { status: 'handoff' } }
    } catch (error) {
      throw new AiAgentToolError('handoff_failed', `AI handoff failed: ${messageOf(error)}`)
    }
  }

  const userId = await loadAiAgentUserId(input.db, input.accountId, input.aiAgentId)

  const dealAction = await executeDealAction({
    db: input.db,
    accountId: input.accountId,
    userId,
    conversationId: input.conversationId,
    contactId: input.context.contact?.id ?? null,
    activeDealId: input.context.activeDeal?.id ?? null,
    action: input.decision.deal_action,
    assertCanRun: input.assertCanRun,
  })
  if (input.decision.action === 'no_reply') return { dealAction }

  await input.assertCanRun?.()
  try {
    const sent = await sendMessageToConversation(input.db, input.accountId, {
      conversationId: input.conversationId,
      messageType: 'text',
      contentText: input.decision.text,
      senderType: 'bot',
      aiGenerated: true,
    })
    return { replyMessageId: sent.messageId, whatsappMessageId: sent.whatsappMessageId, dealAction }
  } catch (error) {
    throw new AiAgentToolError('reply_failed', `AI reply failed: ${messageOf(error)}`)
  }
}

export async function executeDealAction(input: {
  db: SupabaseClient
  accountId: string
  userId: string
  conversationId: string
  contactId: string | null
  activeDealId?: string | null
  action: DealAction | undefined
  assertCanRun?: () => Promise<void>
}): Promise<AiAgentToolResult['dealAction']> {
  const { action } = input
  if (!action || action.type === 'none') return { type: 'none' }

  if (action.type === 'create') {
    if (!input.contactId) throw new AiAgentToolError('missing_contact', 'A contact is required to create a deal')
    await validatePipeline(input.db, input.accountId, action.pipeline_id)
    await validateStage(input.db, action.stage_id, action.pipeline_id)
    await rejectDuplicateOpenDeal(input.db, input.accountId, input.conversationId, input.contactId)
    const currency = await loadDefaultCurrency(input.db, input.accountId)
    await input.assertCanRun?.()
    try {
      const { data, error } = await input.db.from('deals').insert({
        account_id: input.accountId, user_id: input.userId, pipeline_id: action.pipeline_id, stage_id: action.stage_id,
        contact_id: input.contactId, conversation_id: input.conversationId, title: action.title, value: action.value ?? 0,
        currency, status: 'open',
      }).select('id').single()
      if (error || !data) throw error ?? new Error('Deal insert returned no record')
      return { type: 'created', dealId: (data as { id: string }).id }
    } catch (error) {
      throw new AiAgentToolError('deal_write_failed', `Deal creation failed: ${messageOf(error)}`)
    }
  }

  const deal = await validateContextDeal(input.db, input.accountId, input.conversationId, input.contactId, input.activeDealId ?? null, action.deal_id)
  if (action.type === 'move') {
    const stageName = await validateStage(input.db, action.stage_id, deal.pipeline_id)
    await validateConversation(input.db, input.accountId, input.conversationId)
    await input.assertCanRun?.()
    try {
      const { error } = await input.db.from('deals').update({ stage_id: action.stage_id, updated_at: new Date().toISOString() })
        .eq('account_id', input.accountId).eq('id', action.deal_id)
      if (error) throw error
      const { error: markerError } = await input.db.from('messages').insert({
        conversation_id: input.conversationId,
        sender_type: 'bot',
        content_type: 'text',
        content_text: `AI moved deal to ${stageName}`,
        status: 'sent',
      })
      if (markerError) {
        console.error('[ai-agent] deal move marker insert failed:', messageOf(markerError))
      }
      return { type: 'moved', dealId: action.deal_id, stageId: action.stage_id }
    } catch (error) {
      throw new AiAgentToolError('deal_write_failed', `Deal move failed: ${messageOf(error)}`)
    }
  }

  const update: Record<string, string | number> = { updated_at: new Date().toISOString() }
  if (action.title !== undefined) update.title = action.title
  if (action.value !== undefined) update.value = action.value
  if (action.expected_close_date !== undefined) update.expected_close_date = action.expected_close_date
  await input.assertCanRun?.()
  try {
    const { error } = await input.db.from('deals').update(update).eq('account_id', input.accountId).eq('id', action.deal_id)
    if (error) throw error
    return { type: 'updated', dealId: action.deal_id }
  } catch (error) {
    throw new AiAgentToolError('deal_write_failed', `Deal update failed: ${messageOf(error)}`)
  }
}

async function loadAiAgentUserId(db: SupabaseClient, accountId: string, aiAgentId: string): Promise<string> {
  try {
    const { data, error } = await db.from('ai_agents').select('user_id').eq('account_id', accountId).eq('id', aiAgentId).maybeSingle()
    const userId = (data as { user_id?: string } | null)?.user_id
    if (error || !data) throw error ?? new Error('AI agent was not found')
    return userId ?? await loadFallbackAccountUserId(db, accountId)
  } catch (error) {
    throw new AiAgentToolError('deal_write_failed', `AI agent lookup failed: ${messageOf(error)}`)
  }
}

async function loadFallbackAccountUserId(db: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .in('account_role', ['admin', 'agent'])
    .limit(1)
    .maybeSingle()
  const userId = (data as { user_id?: string } | null)?.user_id
  if (error || !userId) throw error ?? new Error('No account user is available for AI-owned deals')
  return userId
}

async function validatePipeline(db: SupabaseClient, accountId: string, pipelineId: string) {
  const { data, error } = await db.from('pipelines').select('id').eq('account_id', accountId).eq('id', pipelineId).maybeSingle()
  if (error || !data) throw new AiAgentToolError('invalid_pipeline', 'Pipeline does not belong to this account')
}

async function validateStage(db: SupabaseClient, stageId: string, pipelineId: string): Promise<string> {
  const { data, error } = await db.from('pipeline_stages').select('id, name').eq('pipeline_id', pipelineId).eq('id', stageId).maybeSingle()
  if (error || !data) throw new AiAgentToolError('invalid_stage', 'Stage does not belong to this pipeline')
  return (data as { name: string }).name
}

async function validateContextDeal(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  contactId: string | null,
  activeDealId: string | null,
  dealId: string,
): Promise<{ id: string; pipeline_id: string }> {
  if (activeDealId !== dealId) {
    throw new AiAgentToolError('invalid_deal', 'Deal is not the active conversation deal')
  }

  const { data: deal, error } = await db
    .from('deals')
    .select('id, pipeline_id, conversation_id, contact_id, status')
    .eq('account_id', accountId)
    .eq('id', dealId)
    .maybeSingle()
  if (error) throw new AiAgentToolError('invalid_deal', 'Deal lookup failed')
  const row = deal as { id: string; pipeline_id: string; conversation_id: string | null; contact_id: string | null; status: string } | null
  if (!row) throw new AiAgentToolError('invalid_deal', 'Deal does not belong to this account')
  if (row.status !== 'open' && row.status !== 'active') {
    throw new AiAgentToolError('invalid_deal', 'Deal is not open')
  }
  if (row.conversation_id === conversationId) return { id: row.id, pipeline_id: row.pipeline_id }

  if (!contactId || row.contact_id !== contactId) {
    throw new AiAgentToolError('invalid_deal', 'Deal is not tied to this conversation contact')
  }
  return { id: row.id, pipeline_id: row.pipeline_id }
}

async function rejectDuplicateOpenDeal(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  contactId: string,
) {
  const { data: conversationDeal, error: conversationError } = await db
    .from('deals')
    .select('id')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .in('status', ['open', 'active'])
    .limit(1)
    .maybeSingle()
  if (conversationError) throw new AiAgentToolError('deal_write_failed', 'Active deal lookup failed')
  if (conversationDeal) throw new AiAgentToolError('duplicate_deal', 'An active deal already exists for this conversation')

  const { data: contactDeal, error: contactError } = await db
    .from('deals')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .in('status', ['open', 'active'])
    .limit(1)
    .maybeSingle()
  if (contactError) throw new AiAgentToolError('deal_write_failed', 'Active deal lookup failed')
  if (contactDeal) throw new AiAgentToolError('duplicate_deal', 'An active deal already exists for this contact')
}

async function validateConversation(db: SupabaseClient, accountId: string, conversationId: string) {
  const { data, error } = await db.from('conversations').select('id').eq('account_id', accountId).eq('id', conversationId).maybeSingle()
  if (error || !data) throw new AiAgentToolError('deal_write_failed', 'Conversation does not belong to this account')
}

async function loadDefaultCurrency(db: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle()
  if (error) return 'USD'
  return (data as { default_currency?: string | null } | null)?.default_currency ?? 'USD'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
