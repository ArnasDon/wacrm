// ============================================================
// Whether a conversation currently sits inside the provider's
// customer-initiated messaging window — i.e. whether a business-sent
// free-form message is allowed right now without a template (WhatsApp)
// or a message tag (Instagram/Facebook).
//
// Lives in its own leaf module — not in `@/lib/quotes/send-quote`,
// which originally defined it — specifically to avoid a circular
// import: `@/lib/instagram/send-message` and `@/lib/facebook/send-message`
// need this to decide whether a HUMAN_AGENT-tagged send is actually
// warranted, but `@/lib/quotes/send-quote` itself imports
// `sendMessageToConversation` from `@/lib/whatsapp/send-message`, which
// branches into both of those. `@/lib/quotes/send-quote` re-exports
// this under its original name so every existing import site keeps
// working unchanged — same pattern as `@/lib/messaging/types`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Meta enforces the window itself and simply errors outside it
 * (`sendMessageToConversation` never pre-checks it for WhatsApp), so
 * callers that want to avoid a doomed send — or branch to a fallback
 * flow instead, like a message tag — check this first.
 */
export async function isWithinMessagingWindow(
  db: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  const { data } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.created_at) return false
  return Date.now() - new Date(data.created_at as string).getTime() < MESSAGING_WINDOW_MS
}
