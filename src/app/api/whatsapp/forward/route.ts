import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message'
import { findOrCreateConversation } from '@/lib/whatsapp/find-or-create-conversation'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { buildMediaPath } from '@/lib/storage/upload-media'

// Matches the bucket name in `message-composer.tsx`'s CHAT_MEDIA_BUCKET —
// duplicated as a literal here (as `template-manager.tsx` already does)
// rather than importing a client-tagged component file into a server route.
const CHAT_MEDIA_BUCKET = 'chat-media'

// Content types a message can be re-sent as. Excludes 'template' (no
// stable content to copy — Meta requires re-approval per send anyway)
// and 'interactive'/'location' (WhatsApp doesn't support forwarding
// those as a plain resend either; out of scope here).
const FORWARDABLE_TYPES = ['text', 'image', 'video', 'document', 'audio'] as const

/**
 * Forward an existing message to one or more contacts — "Encaminhar" in
 * the message context menu. For each target contact this finds-or-
 * creates their conversation and re-sends the same content through the
 * shared send core, exactly as if the agent had typed/attached it fresh.
 *
 * Inbound media is the one wrinkle: `messages.media_url` for a
 * customer-sent attachment is our own `/api/whatsapp/media/:id` proxy,
 * which requires a signed-in session — Meta's servers can't fetch it to
 * deliver the forward. So inbound media is re-downloaded from Meta and
 * re-uploaded to the chat-media bucket first, giving it a real public
 * URL (the same shape agent-sent media already has). Agent-sent media
 * already lives in that bucket and is reused as-is.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const { message_id, contact_ids } = body as {
      message_id?: string
      contact_ids?: string[]
    }

    if (!message_id || !Array.isArray(contact_ids) || contact_ids.length === 0) {
      return NextResponse.json(
        { error: 'message_id and a non-empty contact_ids array are required' },
        { status: 400 },
      )
    }

    // Load the source message, scoped to the caller's account via its
    // conversation (mirrors the account check on every other route here
    // rather than relying on RLS alone).
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('*, conversation:conversations(account_id)')
      .eq('id', message_id)
      .maybeSingle()

    if (msgError || !message || message.conversation?.account_id !== accountId) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (!(FORWARDABLE_TYPES as readonly string[]).includes(message.content_type)) {
      return NextResponse.json(
        { error: `Messages of type "${message.content_type}" can't be forwarded` },
        { status: 400 },
      )
    }

    // Verify every target contact belongs to this account up front —
    // one bad id shouldn't partially forward to the valid ones.
    const { data: contactRows, error: contactsError } = await supabase
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .in('id', contact_ids)

    if (contactsError) {
      return NextResponse.json({ error: 'Failed to verify contacts' }, { status: 500 })
    }
    const validContactIds = new Set((contactRows ?? []).map((c) => c.id))
    const unknownIds = contact_ids.filter((id) => !validContactIds.has(id))
    if (unknownIds.length > 0) {
      return NextResponse.json(
        { error: `Contact(s) not found: ${unknownIds.join(', ')}` },
        { status: 404 },
      )
    }

    // Resolve a Meta-fetchable media URL once, shared across every
    // target contact below — no need to re-host per recipient.
    let mediaUrl: string | null = message.media_url ?? null
    if (mediaUrl && mediaUrl.startsWith('/api/whatsapp/media/')) {
      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('access_token')
        .eq('account_id', accountId)
        .single()
      if (configError || !config) {
        return NextResponse.json(
          { error: 'WhatsApp not configured' },
          { status: 400 },
        )
      }
      const accessToken = decrypt(config.access_token)
      const mediaId = mediaUrl.replace('/api/whatsapp/media/', '')

      try {
        const mediaInfo = await getMediaUrl({ mediaId, accessToken })
        const { buffer, contentType } = await downloadMedia({
          downloadUrl: mediaInfo.url,
          accessToken,
        })
        const ext = contentType.split('/')[1]?.split(';')[0] || 'bin'
        const fileName =
          message.content_type === 'document' && message.content_text
            ? message.content_text
            : `forwarded-${Date.now()}.${ext}`
        const path = buildMediaPath(accountId, fileName)

        const { error: upErr } = await supabase.storage
          .from(CHAT_MEDIA_BUCKET)
          .upload(path, buffer, { contentType, upsert: false })
        if (upErr) throw new Error(upErr.message)

        const {
          data: { publicUrl },
        } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)
        mediaUrl = publicUrl
      } catch (err) {
        console.error('Error re-hosting media for forward:', err)
        return NextResponse.json(
          { error: 'Could not prepare the attachment for forwarding' },
          { status: 500 },
        )
      }
    }

    // Dispatch to each target — independent outcomes, so one contact's
    // failure (e.g. an invalid/unreachable number) doesn't block the rest.
    const results = await Promise.all(
      contact_ids.map(async (contactId) => {
        try {
          const conversationId = await findOrCreateConversation(
            supabase,
            accountId,
            userId,
            contactId,
          )
          if (!conversationId) {
            return { contact_id: contactId, success: false, error: 'Could not open a conversation' }
          }

          await sendMessageToConversation(supabase, accountId, {
            conversationId,
            messageType: message.content_type,
            contentText: message.content_text,
            mediaUrl,
            filename: message.content_type === 'document' ? message.content_text : undefined,
            senderId: userId,
          })
          return { contact_id: contactId, success: true }
        } catch (err) {
          const reason =
            err instanceof SendMessageError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Unknown error'
          return { contact_id: contactId, success: false, error: reason }
        }
      }),
    )

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Error in WhatsApp forward POST:', error)
    return toErrorResponse(error)
  }
}
