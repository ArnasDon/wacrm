import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Return the contact's conversation id in this account, creating one if
 * it doesn't exist yet. Mirrors the webhook's find-or-create so an
 * inbound-then-outbound (or outbound-first) sequence converges on a
 * single thread per contact. Runs under the caller's RLS — the
 * conversations_insert policy requires account agent membership, which
 * every caller of this helper has already been checked for.
 *
 * Shared by `/api/whatsapp/send` (Contact detail → template send) and
 * `/api/whatsapp/forward` (forwarding a message to a contact that may
 * not have an open thread yet).
 */
export async function findOrCreateConversation(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating conversation for contact send:', error.message)
    return null
  }

  return created.id
}
