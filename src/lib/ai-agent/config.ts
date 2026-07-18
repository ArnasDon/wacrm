import type { AiAgent, AiConversationState } from '@/types'
import { supabaseAdmin } from '../flows/admin-client'

export type AiAgentSkipReason =
  | 'missing_config'
  | 'agent_disabled'
  | 'conversation_paused'
  | 'conversation_handoff'
  | 'conversation_disabled'
  | 'duplicate_inbound'
  | 'cooldown_active'
  | 'rate_limited'
  | 'provider_unavailable'

export type AiAgentEligibility =
  | { shouldRun: true; agent: AiAgent; state: AiConversationState | null }
  | {
      shouldRun: false
      reason: AiAgentSkipReason
      agent: AiAgent | null
      state: AiConversationState | null
    }

export interface ShouldRunAiAgentInput {
  accountId: string
  conversationId: string
  inboundMessageId: string
  now?: Date
}

export async function loadAiAgentConfig(accountId: string): Promise<AiAgent | null> {
  const { data, error } = await supabaseAdmin()
    .from('ai_agents')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    throw new Error(`AI agent config lookup failed: ${error.message}`)
  }

  return data as AiAgent | null
}

export async function shouldRunAiAgent(
  input: ShouldRunAiAgentInput,
): Promise<AiAgentEligibility> {
  const agent = await loadAiAgentConfig(input.accountId)
  if (!agent) return skipped('missing_config', null, null)
  if (!agent.enabled) return skipped('agent_disabled', agent, null)

  const { data: rawState, error: stateError } = await supabaseAdmin()
    .from('ai_conversation_states')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('conversation_id', input.conversationId)
    .maybeSingle()

  if (stateError) {
    throw new Error(`AI conversation state lookup failed: ${stateError.message}`)
  }

  const state = rawState as AiConversationState | null
  if (state?.status === 'paused') return skipped('conversation_paused', agent, state)
  if (state?.status === 'handoff') return skipped('conversation_handoff', agent, state)
  if (state?.status === 'disabled') return skipped('conversation_disabled', agent, state)

  const { data: existingRun, error: runError } = await supabaseAdmin()
    .from('ai_agent_runs')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('conversation_id', input.conversationId)
    .eq('inbound_message_id', input.inboundMessageId)
    .limit(1)
    .maybeSingle()

  if (runError) {
    throw new Error(`AI run lookup failed: ${runError.message}`)
  }

  if (existingRun) return skipped('duplicate_inbound', agent, state)

  if (state?.last_run_at) {
    const elapsedMs = (input.now ?? new Date()).getTime() - new Date(state.last_run_at).getTime()
    if (elapsedMs < agent.cooldown_seconds * 1000) {
      return skipped('cooldown_active', agent, state)
    }
  }

  return { shouldRun: true, agent, state }
}

function skipped(
  reason: AiAgentSkipReason,
  agent: AiAgent | null,
  state: AiConversationState | null,
): AiAgentEligibility {
  return { shouldRun: false, reason, agent, state }
}
