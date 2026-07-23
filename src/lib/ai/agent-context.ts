import type { SupabaseClient } from '@supabase/supabase-js'
import type { RetrievedKnowledge } from './knowledge/retrieve'
import { retrieveKnowledge } from './knowledge/retrieve'

const MESSAGE_HISTORY_LIMIT = 20

export interface AgentContext {
  messages: { role: 'customer' | 'agent'; text: string }[]
  dealId: string | null
  currentStageId: string | null
  currentPipelineId: string | null
  knowledge: RetrievedKnowledge[]
}

export interface AgentKnowledgeOptions {
  enabled: boolean
  query: string
  embedding?: { apiKey: string; model: string } | null
}

/**
 * Loads the conversation's recent text history plus its linked deal's
 * current stage, if any — the grounding context for one agent decision
 * call. Deliberately small: this is a single-shot decision, not a
 * multi-turn agent with its own memory beyond the raw message log.
 */
export async function buildAgentContext(
  supabase: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    knowledge?: AgentKnowledgeOptions
  }
): Promise<AgentContext> {
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()

  if (conversationError) {
    throw new Error(`Failed to validate conversation ownership: ${conversationError.message}`)
  }
  if (!conversation) {
    throw new Error('Conversation not found for this account')
  }

  const { data: messageRows, error: messagesError } = await supabase
    .from('messages')
    .select('sender_type, content_text, content_type')
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_HISTORY_LIMIT)

  if (messagesError) throw new Error(`Failed to load messages: ${messagesError.message}`)

  const messages = (
    (messageRows ?? []) as {
      sender_type: string
      content_text: string | null
      content_type: string
    }[]
  )
    .filter((m) => m.content_type === 'text' && m.content_text)
    .reverse()
    .map((m) => ({
      role: (m.sender_type === 'customer' ? 'customer' : 'agent') as 'customer' | 'agent',
      text: m.content_text as string,
    }))

  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('id, stage_id, pipeline_id')
    .eq('account_id', args.accountId)
    .eq('conversation_id', args.conversationId)
    .maybeSingle()

  if (dealError) throw new Error(`Failed to load deals: ${dealError.message}`)

  return attachKnowledgeToAgentContext(
    supabase,
    {
      messages,
      dealId: (deal?.id as string) ?? null,
      currentStageId: (deal?.stage_id as string) ?? null,
      currentPipelineId: (deal?.pipeline_id as string) ?? null,
      knowledge: [],
    },
    args.knowledge,
    args.accountId
  )
}

/** Attaches retrieval results without reloading the conversation snapshot. */
export async function attachKnowledgeToAgentContext(
  supabase: SupabaseClient,
  context: AgentContext,
  knowledgeOptions: AgentKnowledgeOptions | undefined,
  accountId: string
): Promise<AgentContext> {
  const knowledge =
    knowledgeOptions?.enabled === true
      ? await retrieveKnowledge(supabase, {
          accountId,
          query: knowledgeOptions.query,
          embedding: knowledgeOptions.embedding ?? null,
        })
      : []

  return { ...context, knowledge }
}
