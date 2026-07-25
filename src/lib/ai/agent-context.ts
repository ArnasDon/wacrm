import type { SupabaseClient } from '@supabase/supabase-js'

const MESSAGE_HISTORY_LIMIT = 20
const DEFAULT_MAX_CONTEXT_CHARS = 6_000

function readMaxContextChars(): number {
  const raw = process.env.AI_AGENT_MAX_CONTEXT_CHARS
  if (!raw) return DEFAULT_MAX_CONTEXT_CHARS

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_MAX_CONTEXT_CHARS
  return Math.min(value, 20_000)
}

export interface AgentContext {
  messages: { role: 'customer' | 'agent'; text: string }[]
  dealId: string | null
  currentStageId: string | null
  currentPipelineId: string | null
}

/**
 * Loads the conversation's recent text history plus its linked deal's
 * current stage, if any — the grounding context for one agent decision
 * call. Deliberately small: this is a single-shot decision, not a
 * multi-turn agent with its own memory beyond the raw message log.
 */
export async function buildAgentContext(
  supabase: SupabaseClient,
  args: { accountId: string; conversationId: string },
): Promise<AgentContext> {
  const { data: messageRows, error: messagesError } = await supabase
    .from('messages')
    .select('sender_type, content_text, content_type')
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_HISTORY_LIMIT)

  if (messagesError) throw new Error(`Failed to load messages: ${messagesError.message}`)

  const messages = ((messageRows ?? []) as { sender_type: string; content_text: string | null; content_type: string }[])
    .filter((m) => m.content_type === 'text' && m.content_text)
    .reverse()
    .map((m) => ({
      role: (m.sender_type === 'customer' ? 'customer' : 'agent') as 'customer' | 'agent',
      text: m.content_text as string,
    }))

  const maxContextChars = readMaxContextChars()
  let usedContextChars = 0
  const boundedMessages = messages
    .slice()
    .reverse()
    .filter((message) => {
      const nextTotal = usedContextChars + message.text.length
      if (nextTotal > maxContextChars) return false
      usedContextChars = nextTotal
      return true
    })
    .reverse()

  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('id, stage_id, pipeline_id')
    .eq('account_id', args.accountId)
    .eq('conversation_id', args.conversationId)
    .maybeSingle()

  if (dealError) throw new Error(`Failed to load deals: ${dealError.message}`)

  return {
    messages: boundedMessages,
    dealId: (deal?.id as string) ?? null,
    currentStageId: (deal?.stage_id as string) ?? null,
    currentPipelineId: (deal?.pipeline_id as string) ?? null,
  }
}
