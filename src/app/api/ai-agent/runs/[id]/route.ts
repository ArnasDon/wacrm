import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

type RouteContext = { params: Promise<{ id: string }> }

const RUN_COLUMNS = 'id, status, decision, error_message, created_at, started_at, finished_at, conversation_id, inbound_message_id, ai_agent_id, ai_agent:ai_agents(name, model_provider, model_name)'
const STATE_COLUMNS = 'id, status, paused_reason, last_inbound_message_id, last_run_at, created_at, updated_at'
const AI_AGENT_RUN_FAILURE_MESSAGE = 'AI agent run failed'

export async function GET(_request: Request, context: RouteContext) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await context.params
    const { data, error } = await ctx.supabase
      .from('ai_agent_runs')
      .select(RUN_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (error) throw new Error(`AI agent run lookup failed: ${error.message}`)
    if (!data) return notFound()

    const run = data as unknown as RunRow
    const { data: state, error: stateError } = await ctx.supabase
      .from('ai_conversation_states')
      .select(STATE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', run.conversation_id)
      .maybeSingle()
    if (stateError) throw new Error(`AI conversation state lookup failed: ${stateError.message}`)

    return NextResponse.json({
      id: run.id,
      status: run.status,
      decision: run.decision,
      error_message: safeRunErrorMessage(run.error_message),
      created_at: run.created_at,
      started_at: run.started_at,
      finished_at: run.finished_at,
      conversation_id: run.conversation_id,
      inbound_message_id: run.inbound_message_id,
      agent: run.ai_agent
        ? {
            id: run.ai_agent_id,
            name: run.ai_agent.name,
            model_provider: run.ai_agent.model_provider,
            model_name: run.ai_agent.model_name,
          }
        : null,
      state: state ?? null,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

interface RunRow {
  id: string
  status: string
  decision: unknown
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  conversation_id: string
  inbound_message_id: string
  ai_agent_id: string
  ai_agent: { name: string; model_provider: string; model_name: string } | null
}

function notFound() {
  return NextResponse.json({ error: 'AI agent run not found' }, { status: 404 })
}

function safeRunErrorMessage(errorMessage: string | null): string | null {
  return errorMessage ? AI_AGENT_RUN_FAILURE_MESSAGE : null
}
