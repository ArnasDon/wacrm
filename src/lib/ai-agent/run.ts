import {
  createAsyncEventTrace,
  durationMs,
  errorFields,
  type AsyncEventTrace,
  logAsyncEvent,
  logAsyncMetric,
} from '@/lib/observability/async-events'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

import { type AiAgentSkipReason, shouldRunAiAgent } from './config'
import { buildAiAgentContext } from './context'
import {
  type AiAgentDecision,
  type AiAgentDecisionProvider,
  type DealAction,
  getAiAgentMaxOutputTokens,
  requestAiAgentDecision,
} from './decision'
import { resolveAiAgentDecisionProvider } from './providers'
import { executeAiAgentDecision } from './tools'
import type { AiAgent } from '@/types'
import type { AiAgentContext } from './context'

export interface RunAiAgentForInboundMessageInput {
  accountId: string
  conversationId: string
  inboundMessageId: string
  trace?: AsyncEventTrace
  provider?: AiAgentDecisionProvider
  now?: Date
}

export type RunAiAgentForInboundMessageResult =
  | { outcome: 'skipped'; reason: AiAgentSkipReason }
  | { outcome: 'succeeded'; runId: string; decision: AiAgentDecision }
  | { outcome: 'failed'; runId?: string; error: string }

const AI_AGENT_RUN_FAILURE_MESSAGE = 'AI agent run failed'

export async function runAiAgentForInboundMessage(
  input: RunAiAgentForInboundMessageInput,
): Promise<RunAiAgentForInboundMessageResult> {
  const startedAt = Date.now()
  const trace = input.trace ?? createAsyncEventTrace({
    route: 'ai-agent.run',
    accountId: input.accountId,
    conversationId: input.conversationId,
    messageId: input.inboundMessageId,
  })

  let runId: string | undefined
  try {
    const eligibility = await shouldRunAiAgent(input)
    if (!eligibility.shouldRun) return logSkipped(trace, startedAt, eligibility.reason)

    const rateLimit = await checkRateLimit(
      `ai-agent:${input.accountId}:${input.conversationId}`,
      RATE_LIMITS.aiAgentRun,
    )
    if (!rateLimit.success) return logSkipped(trace, startedAt, 'rate_limited')

    const maxOutputTokens = getAiAgentMaxOutputTokens()
    const hasHandoffKeywords = normalizedHandoffKeywords(eligibility.agent).length > 0
    let provider = input.provider ?? null
    if (!hasHandoffKeywords) {
      provider = provider ?? resolveAiAgentDecisionProvider(eligibility.agent)
      if (!provider) return logSkipped(trace, startedAt, 'provider_unavailable')
    }

    const context = await buildAiAgentContext({
      accountId: input.accountId,
      conversationId: input.conversationId,
      maxMessages: eligibility.agent.max_messages,
    })
    const keywordDecision = matchedHandoffKeywordDecision(eligibility.agent, context, input.inboundMessageId)
    provider = provider ?? (keywordDecision ? null : resolveAiAgentDecisionProvider(eligibility.agent))
    if (!keywordDecision && !provider) return logSkipped(trace, startedAt, 'provider_unavailable')

    const now = (input.now ?? new Date()).toISOString()
    const db = supabaseAdmin()
    const { data: run, error: insertError } = await db
      .from('ai_agent_runs')
      .insert({
        account_id: input.accountId,
        ai_agent_id: eligibility.agent.id,
        conversation_id: input.conversationId,
        inbound_message_id: input.inboundMessageId,
        status: 'running',
        started_at: now,
      })
      .select('id')
      .single()
    if (isUniqueViolation(insertError)) return logSkipped(trace, startedAt, 'duplicate_inbound')
    if (insertError || !run) throw insertError ?? new Error('AI run insert returned no record')
    runId = (run as { id: string }).id
    logAsyncEvent('info', 'ai_agent.run.started', trace, {
      run_id: runId,
      model_provider: eligibility.agent.model_provider,
      model_name: eligibility.agent.model_name,
      max_message_count: eligibility.agent.max_messages,
    })

    const decision = applyAiAgentGuardrails(
      keywordDecision
        ?? await requestAiAgentDecision({
          model: eligibility.agent.model_name,
          instructions: eligibility.agent.instructions,
          context,
          provider: provider as AiAgentDecisionProvider,
          maxOutputTokens,
        }),
      eligibility.agent,
    )
    const requestedDealAction = decision.action === 'handoff'
      ? 'none'
      : decision.deal_action?.type ?? 'none'
    logAsyncEvent('info', 'ai_agent.run.decision_received', trace, {
      run_id: runId,
      model_provider: eligibility.agent.model_provider,
      model_name: eligibility.agent.model_name,
      max_message_count: eligibility.agent.max_messages,
      context_message_count: context.messages.length,
      tools_requested: requestedDealAction !== 'none',
      decision_action: decision.action,
      deal_action_type: requestedDealAction,
    })
    const { error: decisionUpdateError } = await db
      .from('ai_agent_runs')
      .update({ decision })
      .eq('id', runId)
      .eq('account_id', input.accountId)
    if (decisionUpdateError) throw decisionUpdateError

    const takeoverSkipReason = await currentConversationSkipReason(db, input.accountId, input.conversationId)
    if (takeoverSkipReason) {
      return await markRunSkipped(db, trace, startedAt, runId, input.accountId, takeoverSkipReason, input.now)
    }

    const assertCanRun = async () => {
      const reason = await currentConversationSkipReason(db, input.accountId, input.conversationId)
      if (reason) throw new AiAgentRunSkippedError(reason)
    }

    const execution = await executeAiAgentDecision({
      db,
      accountId: input.accountId,
      aiAgentId: eligibility.agent.id,
      conversationId: input.conversationId,
      decision,
      context,
      assertCanRun,
    })

    const finishedAt = (input.now ?? new Date()).toISOString()
    const handoff = decision.action === 'handoff' || execution.handoff?.status === 'handoff'
    if (handoff) await assertCanRun()

    const auditUpdated = await recordSuccessfulRunAndState({
      db,
      trace,
      runId,
      input,
      agent: eligibility.agent,
      decision,
      handoff,
      finishedAt,
    })

    const completedDuration = durationMs(startedAt)
    logAsyncEvent('info', 'ai_agent.run.succeeded', trace, {
      run_id: runId,
      decision_action: decision.action,
      deal_action_type: execution.dealAction?.type ?? 'none',
      tools_executed: execution.dealAction?.type !== undefined && execution.dealAction.type !== 'none',
      audit_updated: auditUpdated,
      duration_ms: completedDuration,
    })
    logAsyncMetric('ai_agent.run.completed', trace, {
      run_id: runId,
      outcome: 'succeeded',
      duration_ms: completedDuration,
    })
    return { outcome: 'succeeded', runId, decision }
  } catch (error) {
    if (runId && error instanceof AiAgentRunSkippedError) {
      return await markRunSkipped(supabaseAdmin(), trace, startedAt, runId, input.accountId, error.reason, input.now)
    }

    const failure = safeAiAgentRunFailure(error)
    const failedDuration = durationMs(startedAt)
    logAsyncEvent('error', 'ai_agent.run.failed', trace, {
      run_id: runId,
      duration_ms: failedDuration,
      ...failure.logFields,
    })
    logAsyncMetric('ai_agent.run.completed', trace, {
      run_id: runId,
      outcome: 'failed',
      duration_ms: failedDuration,
    })
    if (runId) {
      const { error: updateError } = await supabaseAdmin()
        .from('ai_agent_runs')
        .update({ status: 'failed', error_message: AI_AGENT_RUN_FAILURE_MESSAGE, finished_at: (input.now ?? new Date()).toISOString() })
        .eq('id', runId)
        .eq('account_id', input.accountId)
      if (updateError) return { outcome: 'failed', runId, error: AI_AGENT_RUN_FAILURE_MESSAGE }
    }
    return runId ? { outcome: 'failed', runId, error: AI_AGENT_RUN_FAILURE_MESSAGE } : { outcome: 'failed', error: AI_AGENT_RUN_FAILURE_MESSAGE }
  }
}

class AiAgentRunSkippedError extends Error {
  constructor(readonly reason: AiAgentSkipReason) {
    super(reason)
    this.name = 'AiAgentRunSkippedError'
  }
}

async function markRunSkipped(
  db: ReturnType<typeof supabaseAdmin>,
  trace: AsyncEventTrace,
  startedAt: number,
  runId: string,
  accountId: string,
  reason: AiAgentSkipReason,
  now?: Date,
): Promise<RunAiAgentForInboundMessageResult> {
  const { error } = await db
    .from('ai_agent_runs')
    .update({ status: 'skipped', error_message: reason, finished_at: (now ?? new Date()).toISOString() })
    .eq('id', runId)
    .eq('account_id', accountId)
  if (error) throw error
  return logSkipped(trace, startedAt, reason)
}

async function currentConversationSkipReason(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  conversationId: string,
): Promise<'conversation_paused' | 'conversation_handoff' | 'conversation_disabled' | null> {
  const status = (await loadCurrentConversationState(db, accountId, conversationId))?.status
  if (status === 'paused') return 'conversation_paused'
  if (status === 'handoff') return 'conversation_handoff'
  if (status === 'disabled') return 'conversation_disabled'
  return null
}

async function loadCurrentConversationState(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  conversationId: string,
): Promise<{ status?: string; paused_reason?: string | null } | null> {
  const { data, error } = await db
    .from('ai_conversation_states')
    .select('status, paused_reason')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) throw error
  return data as { status?: string; paused_reason?: string | null } | null
}

async function recordSuccessfulRunAndState(input: {
  db: ReturnType<typeof supabaseAdmin>
  trace: AsyncEventTrace
  runId: string
  input: RunAiAgentForInboundMessageInput
  agent: AiAgent
  decision: AiAgentDecision
  handoff: boolean
  finishedAt: string
}): Promise<boolean> {
  try {
    const { error: runUpdateError } = await input.db
      .from('ai_agent_runs')
      .update({
        status: 'succeeded',
        decision: input.decision,
        finished_at: input.finishedAt,
        error_message: null,
      })
      .eq('id', input.runId)
      .eq('account_id', input.input.accountId)
    if (runUpdateError) throw runUpdateError

    const currentState = await loadCurrentConversationState(input.db, input.input.accountId, input.input.conversationId)
    const preservedStatus = currentState?.status
      && currentState.status !== 'active'
      && !(input.handoff && currentState.status === 'handoff')
      ? currentState.status
      : null
    const finalStatus = preservedStatus ?? (input.handoff ? 'handoff' : 'active')
    const pausedReason = preservedStatus
      ? currentState?.paused_reason ?? null
      : input.handoff && input.decision.action === 'handoff'
        ? input.decision.reason
        : null

    const { error: stateError } = await input.db.from('ai_conversation_states').upsert(
      {
        account_id: input.input.accountId,
        conversation_id: input.input.conversationId,
        ai_agent_id: input.agent.id,
        status: finalStatus,
        paused_reason: pausedReason,
        last_inbound_message_id: input.input.inboundMessageId,
        last_run_at: input.finishedAt,
        updated_at: input.finishedAt,
      },
      { onConflict: 'account_id,conversation_id' },
    )
    if (stateError) throw stateError
    return true
  } catch (error) {
    logAsyncEvent('error', 'ai_agent.run.audit_update_failed', input.trace, {
      run_id: input.runId,
      ...safeAiAgentRunFailure(error).logFields,
    })
    return false
  }
}

function matchedHandoffKeywordDecision(
  agent: AiAgent,
  context: AiAgentContext,
  inboundMessageId: string,
): AiAgentDecision | null {
  const keywords = normalizedHandoffKeywords(agent)
  if (keywords.length === 0) return null

  const inboundText =
    context.messages.find((message) => message.id === inboundMessageId)?.content_text
    ?? [...context.messages].reverse().find((message) => message.sender_type === 'customer')?.content_text
    ?? ''
  const normalizedText = inboundText.toLowerCase()
  const matched = keywords.find((keyword) => normalizedText.includes(keyword))
  return matched
    ? { action: 'handoff', reason: `Handoff keyword matched: ${matched}`, confidence: 1 }
    : null
}

function normalizedHandoffKeywords(agent: AiAgent): string[] {
  return agent.handoff_keywords
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean)
}

function applyAiAgentGuardrails(decision: AiAgentDecision, agent: AiAgent): AiAgentDecision {
  if (decision.action === 'handoff') return decision
  const deal_action = agent.auto_move_deals ? decision.deal_action : ({ type: 'none' } satisfies DealAction)

  if (decision.action === 'reply' && !agent.auto_reply) {
    return {
      action: 'no_reply',
      reason: 'Auto reply disabled',
      confidence: decision.confidence,
      deal_action,
    }
  }

  if (decision.deal_action === deal_action) return decision
  return { ...decision, deal_action }
}

function logSkipped(
  trace: AsyncEventTrace,
  startedAt: number,
  reason: AiAgentSkipReason,
): RunAiAgentForInboundMessageResult {
  const elapsed = durationMs(startedAt)
  logAsyncEvent('info', 'ai_agent.run.skipped', trace, { reason, duration_ms: elapsed })
  logAsyncMetric('ai_agent.run.completed', trace, { outcome: 'skipped', reason, duration_ms: elapsed })
  return { outcome: 'skipped', reason }
}

function safeAiAgentRunFailure(error: unknown): { logFields: Record<string, string> } {
  const sanitizedError = new Error(AI_AGENT_RUN_FAILURE_MESSAGE)
  const logFields: Record<string, string> = {
    ...(errorFields(sanitizedError) as Record<string, string>),
    error_message: AI_AGENT_RUN_FAILURE_MESSAGE,
  }

  // Do not expose provider-controlled error names, codes, or messages.
  // Only classify known, local error types with fixed safe metadata.
  if (error instanceof Error) logFields.error_class = 'Error'
  if (isSafeAiAgentErrorCode(error)) logFields.error_code = error.code

  return { logFields }
}

function isSafeAiAgentErrorCode(error: unknown): error is { code: 'invalid_json' | 'invalid_decision' | 'missing_contact' | 'invalid_deal' | 'invalid_stage' | 'duplicate_deal' | 'handoff_failed' | 'reply_failed' | 'deal_write_failed' } {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return [
    'invalid_json',
    'invalid_decision',
    'missing_contact',
    'invalid_deal',
    'invalid_stage',
    'duplicate_deal',
    'handoff_failed',
    'reply_failed',
    'deal_write_failed',
  ].includes(error.code as string)
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505'
}
