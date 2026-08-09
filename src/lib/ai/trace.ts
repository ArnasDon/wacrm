import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type ConversationIntent =
  | 'faq'
  | 'sales'
  | 'complaint'
  | 'account'
  | 'smalltalk'

export type AgentModelTier = 'fast' | 'smart'
export type AgentFinalAction = 'reply' | 'handoff' | 'no_reply'

export interface AgentTraceToolCall {
  name: string
  ms: number
  succeeded: boolean
}

export interface AgentTrace {
  accountId: string
  agentId: string
  conversationId: string
  turnId: string
  startedAt: number
  intent: ConversationIntent | null
  toolCalls: AgentTraceToolCall[]
  memoryMatchCount: number
  modelTier: AgentModelTier
  finalAction: AgentFinalAction
  totalMs: number
}

/**
 * Best-effort structured trace for one automatic agent turn.
 *
 * Deliberately stores no message text, tool arguments, tool results, model
 * output or retrieved memories. A trace is operational metadata, never a
 * second copy of the customer's conversation.
 */
export async function recordTrace(
  db: WacrmSupabaseClient,
  trace: AgentTrace,
): Promise<void> {
  try {
    const { error } = await db.from('agent_traces').insert({
      account_id: trace.accountId,
      agent_id: trace.agentId,
      conversation_id: trace.conversationId,
      turn_id: trace.turnId,
      intent: trace.intent,
      model_tier: trace.modelTier,
      final_action: trace.finalAction,
      total_ms: Math.max(0, Math.round(trace.totalMs)),
      memory_match_count: Math.max(0, Math.round(trace.memoryMatchCount)),
      tool_calls: trace.toolCalls.slice(0, 50).map((call, sequence) => ({
        sequence,
        name: call.name,
        ms: Math.max(0, Math.round(call.ms)),
        succeeded: call.succeeded,
      })),
    })
    if (error) console.error('[ai trace] insert failed:', error)
  } catch (error) {
    console.error('[ai trace] insert threw:', error)
  }
}

export interface AgentTraceCollector {
  setIntent: (intent: ConversationIntent, modelTier: AgentModelTier) => void
  setMemoryMatchCount: (count: number) => void
  recordToolCall: (call: AgentTraceToolCall) => void
  finish: (finalAction: AgentFinalAction) => void
}

export function createAgentTraceCollector(args: {
  db: WacrmSupabaseClient
  accountId: string
  agentId: string
  conversationId: string
  turnId?: string
  now?: () => number
}): AgentTraceCollector {
  const now = args.now ?? Date.now
  const startedAt = now()
  let intent: ConversationIntent | null = null
  let modelTier: AgentModelTier = 'smart'
  let memoryMatchCount = 0
  let finished = false
  const toolCalls: AgentTraceToolCall[] = []

  return {
    setIntent(nextIntent, nextModelTier) {
      intent = nextIntent
      modelTier = nextModelTier
    },
    setMemoryMatchCount(count) {
      memoryMatchCount = Math.max(0, Math.round(count))
    },
    recordToolCall(call) {
      if (!finished && toolCalls.length < 50) toolCalls.push({ ...call })
    },
    finish(finalAction) {
      if (finished) return
      finished = true
      void recordTrace(args.db, {
        accountId: args.accountId,
        agentId: args.agentId,
        conversationId: args.conversationId,
        turnId: args.turnId ?? crypto.randomUUID(),
        startedAt,
        intent,
        modelTier,
        finalAction,
        totalMs: Math.max(0, now() - startedAt),
        memoryMatchCount,
        toolCalls,
      })
    },
  }
}
