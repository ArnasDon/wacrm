import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
}

/**
 * Fetch the last N conversational messages and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`.
 *
 * We intentionally include any persisted message that has content_text,
 * not only content_type='text'. WhatsApp interactive button/list replies
 * and media captions carry useful conversational text and must remain in
 * context so a tap on a product can continue the same sales conversation.
 *
 * Ordered oldest-first (chronological) so the transcript reads naturally
 * and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: WacrmSupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', conversationId)
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: m.content_text!.trim(),
    }))
}
