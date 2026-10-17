import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Non-text messages (media,
 * templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
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

/**
 * The id of the most recent customer text message in a conversation, or
 * null if it has none. Used exclusively by dispatchInboundToAiReply's
 * H-6 drain loop (auto-reply.ts) as the "marker" it hands to
 * `release_or_continue_ai_processing` — "was there a newer customer
 * message than the one I just answered?" — never for building the
 * model-facing context itself (buildConversationContext above is
 * unchanged and remains the only source of that).
 */
export async function latestCustomerMessageId(
  db: SupabaseClient,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .eq('content_type', 'text')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { id: string } | null)?.id ?? null
}
