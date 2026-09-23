import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Conversation tenancy guard for the service-role send paths.
//
// Both engines persist an outbound message as `messages.insert({
// conversation_id })` plus a `conversations` preview update, through
// the service-role client — so RLS does not scope either write, and an
// INSERT has no `WHERE` clause to hang a tenancy predicate off.
//
// The engines already refuse a contact outside the account. A
// conversation id was taken on trust, which is what made
// GHSA-m4fx-g6pr-hrw8 exploitable: the manual trigger at
// POST /api/automations/engine copies `body.context` verbatim into the
// run, so `context.conversation_id` is caller-controlled, and a known
// foreign UUID wrote a message row into another tenant's thread.
//
// Callers check here before the Meta call rather than after: once Meta
// has the message it is delivered, and there is nothing left to undo.
// ------------------------------------------------------------

/**
 * Throw unless `conversationId` is a conversation of `accountId`.
 *
 * The message is deliberately the same for "no such conversation" and
 * "not yours" — the engines surface it into automation logs the
 * triggering user can read, and distinguishing the two would confirm
 * whether a given UUID exists.
 *
 * ⚠️ NOSSO (Codex, 3ª rodada do PR #261): com `contactId`, a conversa tem
 * de ser DAQUELE contato também. Só a conta deixava passar o par "contato A
 * + conversa de B" da mesma conta — o envio usa o telefone de A e grava a
 * mensagem e a prévia no fio de B: um cliente recebe o que aparece na
 * conversa de outro. Todo chamador legítimo já passa a conversa do próprio
 * contato. Este arquivo DIVERGE do original por isto: num merge, fica o nosso.
 */
export async function assertConversationInAccount(
  db: SupabaseClient,
  conversationId: string,
  accountId: string,
  contactId?: string | null,
): Promise<void> {
  let consulta = db
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
  if (contactId) consulta = consulta.eq('contact_id', contactId)
  const { data, error } = await consulta.maybeSingle()
  if (error) {
    throw new Error(`conversation lookup failed: ${error.message}`)
  }
  if (!data) {
    throw new Error('conversation not found for this account')
  }
}
