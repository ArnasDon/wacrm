import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Read-only slice of `messages` for the EterWA agent domain — NOT the
// general messages repo (there isn't one; the rest of the app reads
// `messages` directly via `supabaseAdmin()`/the SSR client, out of
// scope to refactor here). This module exists only so the two new
// eter-agent features that need to read `messages` (Meta's 24h
// customer-service session window, and a short "what were we talking
// about" hint for the T+1 follow-up) go through the repo layer like
// the rest of src/lib/eter/repo, instead of a raw `.from('messages')`
// call inlined into product code.
//
// `messages` has no `account_id` column (see
// supabase/migrations/001_initial_schema.sql) — tenancy is enforced
// one hop up, by the caller already having resolved `conversationId`
// within the right account before calling here.
// ============================================================

/** Timestamp of the customer's most recent inbound message in this
 *  conversation, or null if they have never messaged (shouldn't
 *  happen for a conversation the webhook itself created, but a
 *  defensive null is cheaper than an assumption). This — NOT
 *  `conversations.last_message_at`, which also advances on every
 *  OUTBOUND send (see send-message.ts / meta-send.ts) — is what Meta's
 *  24h customer-service window is actually anchored to. */
export async function getLastInboundMessageAt(
  db: SupabaseClient,
  conversationId: string,
): Promise<Date | null> {
  const { data, error } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return new Date((data as { created_at: string }).created_at)
}

/** The most recent inbound message's text, truncated — used as a cheap
 *  "referencing what was being discussed" hint for the T+1 follow-up
 *  copy. Deliberately not an LLM summary (out of scope for this pass,
 *  see followups.ts); a short verbatim excerpt is honest about what it
 *  is and costs nothing extra at schedule time. */
export async function getLastInboundMessageText(
  db: SupabaseClient,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const text = (data as { content_text: string | null } | null)?.content_text
  return text && text.trim() ? text.trim() : null
}
