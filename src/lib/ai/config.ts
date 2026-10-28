import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig, AiProvider } from './types'

interface AiConfigRow {
  provider: AiProvider
  model: string
  api_key: string
  deepseek_api_key?: string | null
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  identity_name?: string | null
  tone_style?: string | null
  team_presentation?: string | null
  global_never_rules?: string | null
  response_style_instructions?: string[] | null
  business_hours_start?: string | null
  business_hours_end?: string | null
  business_days?: number[] | null
  off_hours_instructions?: string | null
  safety_message_limit?: number | null
}

// Exported so /api/ai/config's GET can select the exact same columns —
// this file previously duplicated the list inline and silently drifted
// out of sync when response_style_instructions was added here but not
// there, making it invisible to the Settings/Playground UI (which reads
// via that route) while still reaching the AI itself (which reads via
// loadAiConfig below). One list, used by both paths.
export const CONFIG_COLUMNS =
  'provider, model, api_key, deepseek_api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key, identity_name, tone_style, team_presentation, global_never_rules, response_style_instructions, business_hours_start, business_hours_end, business_days, off_hours_instructions, safety_message_limit'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
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
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: treat a missing key as "not configured"
  if (!row.api_key && !row.deepseek_api_key) return null

  let deepseekApiKey: string | null = null
  if (row.deepseek_api_key) {
    try {
      deepseekApiKey = decrypt(row.deepseek_api_key)
    } catch {
      console.error(
        `[ai config] deepseek key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
      )
      deepseekApiKey = null
    }
  }

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  let apiKey = ''
  if (row.api_key) {
    try {
      apiKey = decrypt(row.api_key)
    } catch (err) {
      if (row.provider !== 'deepseek') throw err
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: apiKey || (deepseekApiKey ?? ''),
    deepseekApiKey,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    identityName: row.identity_name ?? null,
    toneStyle: row.tone_style ?? 'consultative_warm',
    teamPresentation: row.team_presentation ?? null,
    globalNeverRules: row.global_never_rules ?? null,
    responseStyleInstructions: row.response_style_instructions ?? null,
    businessHoursStart: row.business_hours_start ?? '08:00',
    businessHoursEnd: row.business_hours_end ?? '18:00',
    businessDays: row.business_days ?? [1, 2, 3, 4, 5],
    offHoursInstructions: row.off_hours_instructions ?? null,
    safetyMessageLimit: row.safety_message_limit ?? 8,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
