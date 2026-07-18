import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'

type RouteContext = { params: Promise<{ conversationId: string }> }
type AiAction = 'pause' | 'resume' | 'handoff'

const AGENT_COLUMNS = 'id, enabled, name'
const STATE_COLUMNS = 'id, status, paused_reason, last_inbound_message_id, last_run_at, created_at, updated_at'
const RUN_COLUMNS = 'id, status, decision, error_message, created_at, finished_at'

export async function GET(_request: Request, context: RouteContext) {
  try {
    const ctx = await getCurrentAccount()
    const { conversationId } = await context.params
    const conversation = await loadConversation(ctx.supabase, ctx.accountId, conversationId)
    if (!conversation) return notFound()

    return NextResponse.json(await loadStatus(ctx.supabase, ctx.accountId, conversationId))
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole('agent')
    const { conversationId } = await context.params
    const conversation = await loadConversation(ctx.supabase, ctx.accountId, conversationId)
    if (!conversation) return notFound()

    const body = await request.json().catch(() => null)
    const action = parseAction(body)
    if (!action) return NextResponse.json({ error: 'Invalid AI conversation action' }, { status: 400 })

    const { data: agent, error: agentError } = await ctx.supabase
      .from('ai_agents')
      .select(AGENT_COLUMNS)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (agentError) return databaseError('load AI agent configuration', agentError)
    if (!agent) return NextResponse.json({ error: 'AI agent is not configured for this account' }, { status: 400 })

    const reason = optionalReason(body)
    const status = action === 'pause' ? 'paused' : action === 'handoff' ? 'handoff' : 'active'
    const { error: stateError } = await ctx.supabase.from('ai_conversation_states').upsert(
      {
        account_id: ctx.accountId,
        conversation_id: conversationId,
        ai_agent_id: agent.id,
        status,
        paused_reason: action === 'resume' ? null : reason,
      },
      { onConflict: 'account_id,conversation_id' },
    )
    if (stateError) return databaseError('update AI conversation state', stateError)

    if (action === 'handoff') {
      const { error: conversationError } = await ctx.supabase
        .from('conversations')
        .update({ status: 'open' })
        .eq('id', conversationId)
        .eq('account_id', ctx.accountId)
      if (conversationError) return databaseError('keep conversation open', conversationError)
    }

    return NextResponse.json(await loadStatus(ctx.supabase, ctx.accountId, conversationId))
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function loadConversation(supabase: SupabaseClient, accountId: string, conversationId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw new Error(`Conversation lookup failed: ${error.message}`)
  return data
}

async function loadStatus(supabase: SupabaseClient, accountId: string, conversationId: string) {
  const [{ data: agent, error: agentError }, { data: state, error: stateError }, { data: lastRun, error: runError }] = await Promise.all([
    supabase.from('ai_agents').select(AGENT_COLUMNS).eq('account_id', accountId).maybeSingle(),
    supabase.from('ai_conversation_states').select(STATE_COLUMNS).eq('account_id', accountId).eq('conversation_id', conversationId).maybeSingle(),
    supabase.from('ai_agent_runs').select(RUN_COLUMNS).eq('account_id', accountId).eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (agentError) throw new Error(`AI agent lookup failed: ${agentError.message}`)
  if (stateError) throw new Error(`AI conversation state lookup failed: ${stateError.message}`)
  if (runError) throw new Error(`AI agent run lookup failed: ${runError.message}`)

  return {
    agent: agent ?? null,
    state: state ?? null,
    effective_status: !agent || !agent.enabled ? 'disabled' : state?.status ?? 'active',
    last_run: lastRun ?? null,
  }
}

function parseAction(value: unknown): AiAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const action = (value as Record<string, unknown>).action
  return action === 'pause' || action === 'resume' || action === 'handoff' ? action : null
}

function optionalReason(value: unknown): string | null {
  const reason = value && typeof value === 'object' ? (value as Record<string, unknown>).reason : undefined
  return typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null
}

function notFound() {
  return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
}

function databaseError(action: string, error: { message: string }) {
  console.error(`[AI conversation status] Failed to ${action}:`, error)
  return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 })
}
