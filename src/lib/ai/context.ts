import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatImage, ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import {
  MAX_INBOUND_IMAGES_PER_REPLY,
  type InboundImageResolver,
} from './inbound-image'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  media_url: string | null
  media_type: string | null
}

/**
 * Fetch the last N conversational messages and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Plain text and rendered templates
 * are always included.
 *
 * When `imageResolver` is passed (auto-reply path only), inbound
 * customer `image` messages are also included: the caption becomes the
 * turn text (or a placeholder if there was none) and the decoded photo
 * is attached to `images`. Without a resolver the behaviour is
 * unchanged — image rows are skipped, exactly as before.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
  imageResolver?: InboundImageResolver | null,
): Promise<ChatMessage[]> {
  const contentTypes = imageResolver
    ? ['text', 'template', 'image']
    : ['text', 'template']

  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text, media_url, media_type')
    .eq('conversation_id', conversationId)
    // Automation templates persist the rendered/substituted body in
    // content_text. Treat them as assistant turns just like bot text so
    // the AI continues from what the customer actually received.
    .in('content_type', contentTypes)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()

  // Resolve customer photos newest-first so the cap keeps the most
  // recent ones, then stop downloading once we've hit it.
  const imageByRow = new Map<number, ChatImage[]>()
  if (imageResolver) {
    let attached = 0
    for (let i = rows.length - 1; i >= 0 && attached < MAX_INBOUND_IMAGES_PER_REPLY; i--) {
      const m = rows[i]
      if (m.sender_type !== 'customer' || m.content_type !== 'image' || !m.media_url) {
        continue
      }
      const img = await imageResolver(m.media_url, m.media_type)
      if (img) {
        imageByRow.set(i, [img])
        attached += 1
      }
    }
  }

  const out: ChatMessage[] = []
  rows.forEach((m, i) => {
    const role: ChatMessage['role'] = m.sender_type === 'customer' ? 'user' : 'assistant'
    const text = m.content_text?.trim() ?? ''
    const images = imageByRow.get(i)

    if (m.content_type === 'image') {
      // Only surface a photo turn once we actually have the bytes — an
      // image we couldn't download adds nothing and would otherwise
      // become a bare "(el cliente envió una foto)" with no content.
      if (!images || images.length === 0) return
      out.push({
        role,
        content: text || '(El cliente envió una foto.)',
        images,
      })
      return
    }

    if (!text) return
    out.push({ role, content: text })
  })

  return out
}
