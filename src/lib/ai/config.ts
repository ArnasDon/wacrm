import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic' | 'claude-agent-sdk'
  model: string
  // Nullable: 'claude-agent-sdk' accounts have no per-account key at
  // all — see migration 047_claude_agent_sdk_provider.sql.
  api_key: string | null
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  commercial_system_prompt: string | null
  commercial_mode_enabled: boolean
  commercial_booking_url: string | null
  commercial_welcome_message: string | null
  commercial_calendar_id: string | null
  team_phone_numbers: string[] | null
  handoff_message: string | null
  max_handoff_blocked_attempts: number | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key, commercial_system_prompt, commercial_mode_enabled, commercial_booking_url, commercial_welcome_message, commercial_calendar_id, team_phone_numbers, handoff_message, max_handoff_blocked_attempts'

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
  // Defensive: for 'openai'/'anthropic' the column is effectively
  // required (BYO key) — a partial write / manual DB edit leaving it
  // empty means "not configured", same as before. 'claude-agent-sdk'
  // never has a per-account key at all (it authenticates with the
  // service's own CLAUDE_CODE_OAUTH_TOKEN — see
  // providers/claude-agent-sdk.ts), so a null key there is the normal,
  // expected shape, not a broken config.
  if (row.provider !== 'claude-agent-sdk' && !row.api_key) return null

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

  return {
    provider: row.provider,
    model: row.model,
    // '' for claude-agent-sdk (never read — see providers/claude-agent-sdk.ts).
    apiKey: row.api_key ? decrypt(row.api_key) : '',
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    commercialModeEnabled: row.commercial_mode_enabled,
    commercialSystemPrompt: row.commercial_system_prompt,
    commercialBookingUrl: row.commercial_booking_url,
    commercialWelcomeMessage: row.commercial_welcome_message,
    commercialCalendarId: row.commercial_calendar_id,
    teamPhoneNumbers: row.team_phone_numbers ?? [],
    handoffMessage: row.handoff_message,
    // NOT NULL DEFAULT 2 na base de dados (migração 050) — o ?? aqui é
    // só defesa extra para linhas antigas escritas antes da coluna
    // existir ou literais de teste que não a definem.
    maxHandoffBlockedAttempts: row.max_handoff_blocked_attempts ?? 2,
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
