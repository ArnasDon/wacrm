import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Everything a tool handler needs beyond the model-supplied `input` —
 * bound once per agent turn by `createEterToolExecutor`
 * (handlers/index.ts). `accountId` is always present and is what every
 * repo call below is scoped by; `conversationId` / `contactId` are the
 * WhatsApp thread this turn is running in and are used as a fallback
 * when the model's tool call omits them (it usually does, since it has
 * no reason to repeat ids it didn't choose).
 */
export interface ToolHandlerContext {
  db: SupabaseClient
  accountId: string
  conversationId: string | null
  contactId: string | null
  /** Recipient for notify_admin — typically the account's configured
   *  handoff agent (`AiConfig.handoffAgentId`). `null` means there's no
   *  one configured to notify; the handler reports that as a tool
   *  error rather than silently dropping the alert. */
  defaultNotifyUserId: string | null
}
