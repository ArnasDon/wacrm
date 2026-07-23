import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig, AiProvider } from './types'

interface AiConfigRow {
  account_id: string
  provider: AiProvider
  model: string
  api_key_encrypted: string
  agent_enabled: boolean
  pipeline_move_enabled: boolean
  knowledge_enabled: boolean
  embeddings_model: string
  embeddings_api_key_encrypted: string | null
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
}

export async function loadAiConfig(supabase: SupabaseClient, accountId: string): Promise<AiConfig | null> {
  const { data, error } = await supabase
    .from('ai_configs')
    .select(
      'account_id, provider, model, api_key_encrypted, agent_enabled, pipeline_move_enabled, knowledge_enabled, embeddings_model, embeddings_api_key_encrypted, auto_reply_max_per_conversation, handoff_agent_id',
    )
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load AI config: ${error.message}`)
  if (!data) return null
  const row = data as AiConfigRow

  return {
    accountId: row.account_id,
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key_encrypted),
    agentEnabled: row.agent_enabled,
    pipelineMoveEnabled: row.pipeline_move_enabled,
    knowledgeEnabled: row.knowledge_enabled,
    embeddingsModel: row.embeddings_model,
    embeddingsApiKey: row.embeddings_api_key_encrypted ? decrypt(row.embeddings_api_key_encrypted) : null,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
  }
}

export interface SaveAiConfigInput {
  provider: AiProvider
  model: string
  apiKey: string
  agentEnabled: boolean
  pipelineMoveEnabled: boolean
  knowledgeEnabled: boolean
  embeddingsModel: string
  embeddingsApiKey: string | null
  autoReplyMaxPerConversation: number
  handoffAgentId: string | null
}

export async function saveAiConfig(
  supabase: SupabaseClient,
  accountId: string,
  input: SaveAiConfigInput,
): Promise<void> {
  const { error } = await supabase.from('ai_configs').upsert({
    account_id: accountId,
    provider: input.provider,
    model: input.model,
    api_key_encrypted: encrypt(input.apiKey),
    agent_enabled: input.agentEnabled,
    pipeline_move_enabled: input.pipelineMoveEnabled,
    knowledge_enabled: input.knowledgeEnabled,
    embeddings_model: input.embeddingsModel,
    embeddings_api_key_encrypted: input.embeddingsApiKey ? encrypt(input.embeddingsApiKey) : null,
    auto_reply_max_per_conversation: input.autoReplyMaxPerConversation,
    handoff_agent_id: input.handoffAgentId,
  })
  if (error) throw error
}
