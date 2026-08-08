import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  reply_to_message_id: string | null
}

function readableMessageContent(message: DbMessage): string | null {
  const text = message.content_text?.trim()
  if (!text) return null

  if (message.content_type === 'image') {
    return `[Produto/fotografia enviada no WhatsApp]\n${text}`
  }
  if (message.content_type === 'interactive') {
    return `[Opção interactiva no WhatsApp]\n${text}`
  }
  return text
}

/**
 * Fetch the recent conversation in a model-friendly form.
 *
 * A manual AI-context reset is non-destructive: old WhatsApp messages remain
 * visible for audit and for human agents, but messages created before
 * conversations.ai_context_reset_at are excluded from the model context.
 *
 * Product-image captions are intentionally retained: when a customer
 * uses WhatsApp's Reply action on a product photograph, reply_to_message_id
 * identifies exactly which visual card they selected. The generated user
 * turn then names that parent message explicitly, so the model never has
 * to guess which product "este", "esse" or "quero" refers to.
 */
export async function buildConversationContext(
  db: WacrmSupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('ai_context_reset_at')
    .eq('id', conversationId)
    .maybeSingle()

  if (conversationError) throw conversationError

  let query = db
    .from('messages')
    .select('id, sender_type, content_type, content_text, reply_to_message_id')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'image', 'interactive'])

  const resetAt = conversation?.ai_context_reset_at
  if (typeof resetAt === 'string' && resetAt) {
    query = query.gt('created_at', resetAt)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const byId = new Map(rows.map((message) => [message.id, message]))

  return rows.flatMap((message): ChatMessage[] => {
    const content = readableMessageContent(message)
    if (!content) return []

    let resolvedContent = content
    if (message.sender_type === 'customer' && message.reply_to_message_id) {
      const parent = byId.get(message.reply_to_message_id)
      const parentContent = parent ? readableMessageContent(parent) : null
      if (parentContent) {
        resolvedContent = [
          'O cliente respondeu directamente a esta mensagem/produto anterior:',
          parentContent,
          '',
          `Resposta do cliente: ${content}`,
        ].join('\n')
      }
    }

    return [
      {
        role: message.sender_type === 'customer' ? 'user' : 'assistant',
        content: resolvedContent,
      },
    ]
  })
}
