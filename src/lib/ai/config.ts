import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  commercialStrategyPrompt,
  normalizeCommercialStrategy,
} from './commercial-strategy'
import type { AiConfig } from './types'

interface AiConfigRow {
  id: string
  provider: 'openai' | 'anthropic'
  model: string
  api_key: string
  system_prompt: string | null
  commercial_strategy: unknown
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  buffer_window_seconds: number
  max_reply_chunks: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
}

const CONFIG_COLUMNS =
  'id, provider, model, api_key, system_prompt, commercial_strategy, is_active, auto_reply_enabled, auto_reply_max_per_conversation, buffer_window_seconds, max_reply_chunks, handoff_agent_id, embeddings_api_key'

export async function loadAiConfig(
  db: WacrmSupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  if (requireActive && !row.is_active) return null
  if (!row.api_key) return null

  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  const commercialStrategy = normalizeCommercialStrategy(row.commercial_strategy)
  const systemPrompt = [
    commercialStrategyPrompt(commercialStrategy),
    row.system_prompt?.trim() || null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')

  return {
    agentId: row.id,
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt,
    commercialStrategy,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    bufferWindowSeconds: row.buffer_window_seconds,
    maxReplyChunks: row.max_reply_chunks,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
  }
}

export async function loadEmbeddingsKey(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('provider, api_key, embeddings_api_key, is_active')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !data || !data.is_active) {
    return { key: null, corrupt: false }
  }

  // Prefer a dedicated OpenAI key when the account has one. This keeps
  // embeddings/transcription billing separable from the main AI provider.
  if (data.embeddings_api_key) {
    try {
      return { key: decrypt(data.embeddings_api_key), corrupt: false }
    } catch {
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
      )
      return { key: null, corrupt: true }
    }
  }

  // Voice-note transcription and embeddings both use OpenAI endpoints. When
  // the account itself already uses OpenAI, reuse its primary API key so the
  // feature works without forcing a second key to be configured.
  if (data.provider === 'openai' && data.api_key) {
    try {
      return { key: decrypt(data.api_key), corrupt: false }
    } catch {
      console.error(
        `[ai config] primary OpenAI key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
      )
      return { key: null, corrupt: true }
    }
  }

  return { key: null, corrupt: false }
}
