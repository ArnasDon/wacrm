import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Prune bare `conversation.started` conversations that never got a
// message.
//
// The WhatsApp-via-Zernio webhook creates a contact + conversation on
// Zernio's `conversation.started` event, before any message, so a later
// Coexistence echo (an agent replying from the official WhatsApp app)
// has a row to attach to. But Zernio also fires `conversation.started`
// in bulk when a number (re)connects — a burst of conversation rows
// that never receive a message. The inbox already hides message-less
// conversations from the list; this removes the stale ones from the DB
// so the table doesn't accumulate them across reconnects.
//
// A genuine agent-first thread gets its echo within seconds, so a week
// with zero messages is a safe cutoff. Only rows with no message at all
// AND a null `last_message_at` are touched.
// ============================================================

const STALE_AFTER_DAYS = 7
const MAX_PER_RUN = 500

export interface PruneEmptyResult {
  pruned: number
}

export async function pruneEmptyStaleConversations(
  db: SupabaseClient,
  now: number = Date.now(),
): Promise<PruneEmptyResult> {
  const cutoff = new Date(now - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: candidates, error } = await db
    .from('conversations')
    .select('id')
    .is('last_message_at', null)
    .lt('created_at', cutoff)
    .limit(MAX_PER_RUN)
  if (error || !candidates || candidates.length === 0) return { pruned: 0 }

  const ids = candidates.map((c) => c.id as string)

  // Double-check against `messages` — `last_message_at` is the fast
  // filter, but never delete a conversation that actually has a row.
  const { data: withMsgs } = await db
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', ids)
  const hasMessage = new Set((withMsgs ?? []).map((m) => m.conversation_id as string))
  const deletable = ids.filter((id) => !hasMessage.has(id))
  if (deletable.length === 0) return { pruned: 0 }

  const { error: delError, count } = await db
    .from('conversations')
    .delete({ count: 'exact' })
    .in('id', deletable)
  if (delError) {
    console.error('[prune-empty] delete failed:', delError.message)
    return { pruned: 0 }
  }

  return { pruned: count ?? deletable.length }
}
