import type { ContentType, ConversationStatus, DealStatus, SenderType } from '@/types'
import { supabaseAdmin } from '../flows/admin-client'

export interface BuildAiAgentContextInput {
  accountId: string
  conversationId: string
  maxMessages: number
}

export interface AiAgentContextMessage {
  id: string
  sender_type: SenderType
  content_type: ContentType
  content_text: string | null
  media_url: string | null
  message_id: string | null
  created_at: string
}

export interface AiAgentContextContact {
  id: string
  phone: string
  name: string | null
  email: string | null
  company: string | null
}

export interface AiAgentContextConversation {
  id: string
  status: ConversationStatus
  assigned_agent_id: string | null
  last_message_text: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export interface AiAgentContextDeal {
  id: string
  pipeline_id: string
  stage_id: string
  contact_id: string | null
  conversation_id: string | null
  title: string
  value: number
  currency: string | null
  expected_close_date: string | null
  status: DealStatus | 'active'
}

export interface AiAgentContextPipelineStage {
  id: string
  name: string
  position: number
  color: string
}

export interface AiAgentContextPipeline {
  id: string
  name: string
  stages: AiAgentContextPipelineStage[]
}

export interface AiAgentContext {
  conversation: AiAgentContextConversation
  contact: AiAgentContextContact | null
  messages: AiAgentContextMessage[]
  activeDeal: AiAgentContextDeal | null
  pipelines: AiAgentContextPipeline[]
}

type ConversationRow = AiAgentContextConversation & {
  contact_id: string | null
  contact: AiAgentContextContact | AiAgentContextContact[] | null
}

export async function buildAiAgentContext(
  input: BuildAiAgentContextInput,
): Promise<AiAgentContext> {
  const db = supabaseAdmin()
  const { data: conversationData, error: conversationError } = await db
    .from('conversations')
    .select('id, contact_id, status, assigned_agent_id, last_message_text, last_message_at, created_at, updated_at, contact:contacts(id, phone, name, email, company)')
    .eq('account_id', input.accountId)
    .eq('id', input.conversationId)
    .maybeSingle()

  if (conversationError) {
    throw new Error(`AI conversation context lookup failed: ${conversationError.message}`)
  }
  if (!conversationData) throw new Error('AI conversation context not found')

  const conversationRow = conversationData as unknown as ConversationRow
  const contact = Array.isArray(conversationRow.contact)
    ? conversationRow.contact[0] ?? null
    : conversationRow.contact
  const conversation: AiAgentContextConversation = {
    id: conversationRow.id,
    status: conversationRow.status,
    assigned_agent_id: conversationRow.assigned_agent_id,
    last_message_text: conversationRow.last_message_text,
    last_message_at: conversationRow.last_message_at,
    created_at: conversationRow.created_at,
    updated_at: conversationRow.updated_at,
  }
  const { data: messageData, error: messageError } = await db
    .from('messages')
    .select('id, sender_type, content_type, content_text, media_url, message_id, created_at')
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, input.maxMessages))

  if (messageError) {
    throw new Error(`AI message context lookup failed: ${messageError.message}`)
  }

  const activeDeal = await loadActiveDeal(db, input.accountId, input.conversationId, conversationRow.contact_id)
  const pipelines = await loadPipelines(db, input.accountId)

  return {
    conversation: conversation,
    contact,
    messages: ((messageData ?? []) as AiAgentContextMessage[]).reverse(),
    activeDeal,
    pipelines,
  }
}

async function loadActiveDeal(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  conversationId: string,
  contactId: string | null,
): Promise<AiAgentContextDeal | null> {
  const { data: conversationDeal, error: conversationDealError } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id, contact_id, conversation_id, title, value, currency, expected_close_date, status')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .in('status', ['open', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (conversationDealError) {
    throw new Error(`AI deal context lookup failed: ${conversationDealError.message}`)
  }
  if (conversationDeal || !contactId) return conversationDeal as AiAgentContextDeal | null

  const { data: contactDeal, error: contactDealError } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id, contact_id, conversation_id, title, value, currency, expected_close_date, status')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .in('status', ['open', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (contactDealError) {
    throw new Error(`AI deal context lookup failed: ${contactDealError.message}`)
  }

  return contactDeal as AiAgentContextDeal | null
}

async function loadPipelines(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
): Promise<AiAgentContextPipeline[]> {
  const { data: pipelineData, error: pipelineError } = await db
    .from('pipelines')
    .select('id, name')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })

  if (pipelineError) {
    throw new Error(`AI pipeline context lookup failed: ${pipelineError.message}`)
  }

  const pipelines = (pipelineData ?? []) as Array<Omit<AiAgentContextPipeline, 'stages'>>
  if (pipelines.length === 0) return []

  const pipelineIds = pipelines.map((pipeline) => pipeline.id)
  const { data: stageData, error: stageError } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id, name, position, color')
    .in('pipeline_id', pipelineIds)
    .order('position', { ascending: true })

  if (stageError) {
    throw new Error(`AI pipeline stage context lookup failed: ${stageError.message}`)
  }

  const stagesByPipeline = new Map<string, AiAgentContextPipelineStage[]>()
  for (const stage of (stageData ?? []) as Array<AiAgentContextPipelineStage & { pipeline_id: string }>) {
    const stages = stagesByPipeline.get(stage.pipeline_id) ?? []
    stages.push(stage)
    stagesByPipeline.set(stage.pipeline_id, stages)
  }

  return pipelines.map((pipeline) => ({
    ...pipeline,
    stages: stagesByPipeline.get(pipeline.id) ?? [],
  }))
}
