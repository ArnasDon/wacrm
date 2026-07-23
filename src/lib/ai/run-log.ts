import type { SupabaseClient } from '@supabase/supabase-js'

type AiRunSurface = 'whatsapp_agent' | 'automation_copilot' | 'knowledge_ingest' | 'manual_test'
type AiRunStatus = 'started' | 'completed' | 'failed' | 'skipped'
type ToolStatus = 'proposed' | 'executed' | 'rejected' | 'skipped' | 'failed'

export async function createAiRun(
  supabase: SupabaseClient,
  input: {
    accountId: string
    conversationId?: string | null
    userId?: string | null
    surface: AiRunSurface
    agentRole: string
    provider?: string | null
    model?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ai_runs')
    .insert({
      account_id: input.accountId,
      conversation_id: input.conversationId ?? null,
      user_id: input.userId ?? null,
      surface: input.surface,
      agent_role: input.agentRole,
      provider: input.provider ?? null,
      model: input.model ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()

  if (error) {
    console.error('[ai-run-log] createAiRun failed:', error)
    return null
  }
  return (data as { id: string }).id
}

export async function completeAiRun(
  supabase: SupabaseClient,
  input: {
    accountId: string
    runId: string | null
    status: AiRunStatus
    inputTokens?: number | null
    outputTokens?: number | null
    error?: string | null
  },
): Promise<void> {
  if (!input.runId) return
  const { error } = await supabase
    .from('ai_runs')
    .update({
      status: input.status,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      error: input.error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', input.runId)
    .eq('account_id', input.accountId)

  if (error) console.error('[ai-run-log] completeAiRun failed:', error)
}

export async function logAiRetrievalEvent(
  supabase: SupabaseClient,
  input: {
    accountId: string
    runId: string | null
    query: string
    retrievalMode: 'fts' | 'semantic' | 'hybrid'
    chunkIds: string[]
    scores: unknown[]
  },
): Promise<void> {
  if (!input.runId) return
  const { error } = await supabase.from('ai_retrieval_events').insert({
    account_id: input.accountId,
    ai_run_id: input.runId,
    query: input.query,
    retrieval_mode: input.retrievalMode,
    chunk_ids: input.chunkIds,
    scores: input.scores,
  })
  if (error) console.error('[ai-run-log] logAiRetrievalEvent failed:', error)
}

export async function logAiToolCall(
  supabase: SupabaseClient,
  input: {
    accountId: string
    runId: string | null
    toolName: string
    arguments: Record<string, unknown>
    status: ToolStatus
    result?: Record<string, unknown>
    error?: string | null
  },
): Promise<void> {
  if (!input.runId) return
  const { error } = await supabase.from('ai_tool_calls').insert({
    account_id: input.accountId,
    ai_run_id: input.runId,
    tool_name: input.toolName,
    arguments: input.arguments,
    status: input.status,
    result: input.result ?? {},
    error: input.error ?? null,
  })
  if (error) console.error('[ai-run-log] logAiToolCall failed:', error)
}
