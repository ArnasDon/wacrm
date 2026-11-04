import type { SupabaseClient } from '@supabase/supabase-js'

export async function claimFirstInboundMessage(
  db: SupabaseClient,
  conversation: { id: string; first_inbound_at?: string | null },
  receivedAt: string,
): Promise<boolean> {
  if (conversation.first_inbound_at) return false

  const { data, error } = await db
    .from('conversations')
    .update({ first_inbound_at: receivedAt })
    .eq('id', conversation.id)
    .is('first_inbound_at', null)
    .select('id')

  if (error) {
    console.error('Error claiming first inbound message:', error)
    return false
  }
  return (data?.length ?? 0) > 0
}
