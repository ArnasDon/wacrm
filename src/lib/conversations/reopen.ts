import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Re-open a closed conversation because the customer wrote again
 * (issue #409).
 *
 * Inbound processing bumps `unread_count` but used to leave `status`
 * alone, so a thread an agent closed — or that a `close_conversation`
 * automation step closed — stayed `closed` while accumulating unread
 * customer messages. It read as resolved, and it dropped out of the
 * inbox's Open filter, so an agent working that filter never saw the
 * reply. (Automation dispatch is unaffected either way: it keys on
 * account + trigger + contact, never conversation status.)
 *
 * Lives here rather than inline in the webhook so it can be tested
 * without standing up the whole route, and so any future inbound path
 * gets the same behaviour for free.
 */
export async function reopenClosedConversation(
  db: SupabaseClient,
  conversation: { id: string; status?: string | null },
): Promise<boolean> {
  // Nothing to do for open/pending threads, which is the common case —
  // skipping the round trip keeps inbound processing as cheap as it was.
  if (conversation.status !== 'closed') return false

  const { error } = await db
    .from('conversations')
    .update({ status: 'open', updated_at: new Date().toISOString() })
    .eq('id', conversation.id)
    // Re-checked in SQL, not just in the `if` above: the caller's row was
    // read earlier in the request, so two concurrent inbound deliveries
    // both holding a stale `status: 'closed'` must not be able to write
    // 'open' back over an agent who re-closed the thread in between.
    .eq('status', 'closed')

  if (error) {
    // Best-effort, same as the conversation update this follows: a failed
    // re-open must not abort inbound processing (and make Meta redeliver).
    console.error('Error re-opening conversation:', error)
    return false
  }

  return true
}
