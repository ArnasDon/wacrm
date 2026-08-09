import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { ResolveAiImage } from './image-context'
import { type ChatContent, type ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  media_url: string | null
  reply_to_message_id: string | null
}

const MAX_CONTEXT_IMAGES = 3

function readableMessageText(message: DbMessage): string | null {
  const text = message.content_text?.trim()

  if (message.content_type === 'image') {
    return text
      ? `[Imagem enviada no WhatsApp]\nLegenda: ${text}`
      : '[Imagem enviada no WhatsApp sem legenda]'
  }
  if (message.content_type === 'interactive') {
    if (!text) return null
    return `[Opção interactiva no WhatsApp]\n${text}`
  }
  return text || null
}

function prependText(content: ChatContent, text: string): ChatContent {
  if (typeof content === 'string') return `${text}\n${content}`
  return [{ type: 'text', text }, ...content]
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
  options: {
    limit?: number
    resolveImage?: ResolveAiImage
  } = {},
): Promise<ChatMessage[]> {
  const { limit = aiContextMessageLimit(), resolveImage } = options
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('ai_context_reset_at')
    .eq('id', conversationId)
    .maybeSingle()

  if (conversationError) throw conversationError

  let query = db
    .from('messages')
    .select('id, sender_type, content_type, content_text, media_url, reply_to_message_id')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'image', 'interactive'])

  const resetAt = conversation?.ai_context_reset_at
  if (typeof resetAt === 'string' && resetAt) {
    query = query.gt('created_at', resetAt)
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const byId = new Map(rows.map((message) => [message.id, message]))
  const imageIds = new Set(
    rows
      .filter(
        (message) =>
          message.sender_type === 'customer' &&
          message.content_type === 'image' &&
          Boolean(message.media_url),
      )
      .slice(-MAX_CONTEXT_IMAGES)
      .map((message) => message.id),
  )

  const messages = await Promise.all(
    rows.map(async (message): Promise<ChatMessage | null> => {
      const readableText = readableMessageText(message)
      if (!readableText) return null

      let content: ChatContent = readableText
      if (resolveImage && imageIds.has(message.id) && message.media_url) {
        const image = await resolveImage(message.media_url)
        if (image) {
          // Image-first follows Anthropic's current vision guidance; OpenAI
          // accepts either order. The text placeholder is kept so retrying a
          // text-only model still leaves useful conversational context.
          content = [image, { type: 'text', text: readableText }]
        }
      }

      if (message.sender_type === 'customer' && message.reply_to_message_id) {
        const parent = byId.get(message.reply_to_message_id)
        const parentText = parent ? readableMessageText(parent) : null
        if (parentText) {
          content = prependText(
            content,
            [
              'O cliente respondeu directamente a esta mensagem/produto anterior:',
              parentText,
              '',
              'Resposta actual do cliente:',
            ].join('\n'),
          )
        }
      }

      return {
        role: message.sender_type === 'customer' ? 'user' : 'assistant',
        content,
      }
    }),
  )

  return messages.filter((message): message is ChatMessage => Boolean(message))
}
