// ============================================================
// Send-time fallback: find *a* Zernio conversation id for a contact.
//
// Every Zernio IG/FB send addresses an existing conversation by its
// opaque `zernio_conversation_id`. That id normally arrives on the
// `conversation.started` / first `message.received` webhook and is
// stamped on `conversations` (see `findOrCreateConversation` in
// dm-inbound.ts). If a webhook was missed, or an older duplicate row
// is the one open in the inbox, the row an agent is replying from can
// have a NULL id — and the reply hard-fails even though the customer
// clearly messaged (often from an ad or a post → DM).
//
// This resolves the id from ANY sibling conversation of the same
// contact + channel that carries one, so the reply still goes out.
// Leaf module (no local imports) so the two send paths can use it
// without an import cycle back through the webhook stack.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The most recently active `zernio_conversation_id` on record for this
 * contact + channel, or null when none exists yet (the customer really
 * hasn't messaged through Zernio). Used only as a fallback when the
 * conversation being replied to has no id of its own.
 */
export async function resolveZernioConversationIdForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  channel: 'instagram' | 'facebook' | 'whatsapp',
): Promise<string | null> {
  const { data, error } = await db
    .from('conversations')
    .select('zernio_conversation_id, last_message_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .not('zernio_conversation_id', 'is', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)

  if (error) {
    console.error('[resolve-zernio-conversation] lookup failed:', error.message)
    return null
  }
  return (data?.[0]?.zernio_conversation_id as string | undefined) ?? null
}
