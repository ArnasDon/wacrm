/**
 * Provider-agnostic inbound Instagram DM handling — contact/conversation
 * resolution, idempotent message persistence, and the flows/automations/
 * AI-reply/outbound-webhook fan-out.
 *
 * Extracted from what was previously inline in
 * `src/app/api/instagram/webhook/route.ts` (the Meta-direct webhook)
 * so the Zernio webhook route
 * (`src/app/api/instagram/webhook/zernio/route.ts`) can reuse the
 * exact same downstream behavior after normalizing its
 * differently-shaped payload into `InboundInstagramMessage`. Nothing
 * about the Meta route's own behavior changes — this is a pure
 * extraction.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { findExistingInstagramContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export interface InboundInstagramMessage {
  accountId: string
  configOwnerUserId: string
  /** Sender's Instagram-Scoped ID (IGSID). */
  igsid: string
  /** Platform message id — used as the idempotency key for retried deliveries. */
  mid: string
  contentText: string | null
  mediaUrl: string | null
  contentType: string
  interactiveReplyId: string | null
  /** Platform message id of the message this one quote-replies to, if any. */
  replyToMid: string | null
  /**
   * Zernio's own opaque conversation id, stored on the conversation row
   * so later outbound sends know which Zernio conversation to post
   * into. Omitted (undefined) on the Meta-direct path, which has no
   * such concept — `contacts.instagram_id` is enough to send there.
   */
  zernioConversationId?: string
  /**
   * Best-effort profile lookup for contact creation. Meta's path fetches
   * this lazily via a Graph API call (only within the messaging window);
   * Zernio already includes name/username inline on the webhook payload,
   * so its implementation just returns them synchronously. Must never
   * throw — return null on any failure, same contract as
   * `getIgUserProfile`.
   */
  resolveProfile: () => Promise<{ name?: string; username?: string } | null>
}

const ALLOWED_CONTENT_TYPES = new Set(['text', 'image', 'document', 'audio', 'video'])

/** Normalize a provider-specific attachment type string to wacrm's content_type enum. */
export function toContentType(attachmentType: string): string {
  if (attachmentType === 'file') return 'document'
  if (attachmentType === 'sticker') return 'image'
  return ALLOWED_CONTENT_TYPES.has(attachmentType) ? attachmentType : 'text'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  wasCreated: boolean
}

async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  igsid: string,
  resolveProfile: () => Promise<{ name?: string; username?: string } | null>,
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingInstagramContact(db, accountId, igsid)
  if (existingContact) {
    return { contact: existingContact, wasCreated: false }
  }

  const profile = await resolveProfile()

  const { data: newContact, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone: null,
      instagram_id: igsid,
      instagram_username: profile?.username ?? null,
      name: profile?.name || profile?.username || igsid,
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingInstagramContact(db, accountId, igsid)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[instagram inbound] error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(db: SupabaseClient, accountId: string, configOwnerUserId: string, contactId: string) {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[instagram inbound] error finding conversation:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
      channel: 'instagram',
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false }
      }
    }
    console.error('[instagram inbound] error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}

/** Mirror a read receipt onto `messages.status`, shared by both webhook routes. */
export async function markMessageRead(db: SupabaseClient, platformMessageId: string): Promise<void> {
  const { error } = await db.from('messages').update({ status: 'read' }).eq('message_id', platformMessageId)
  if (error) {
    console.error('[instagram inbound] error updating message read status:', error)
  }
}

export async function handleInboundInstagramMessage(db: SupabaseClient, msg: InboundInstagramMessage): Promise<void> {
  const { accountId, configOwnerUserId } = msg

  const contactOutcome = await findOrCreateContact(db, accountId, configOwnerUserId, msg.igsid, msg.resolveProfile)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(db, accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  if (convResult.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
      channel: 'instagram',
    })
  }

  if (msg.zernioConversationId && conversation.zernio_conversation_id !== msg.zernioConversationId) {
    await db
      .from('conversations')
      .update({ zernio_conversation_id: msg.zernioConversationId })
      .eq('id', conversation.id)
  }

  let replyToInternalId: string | null = null
  if (msg.replyToMid) {
    const { data: parent } = await db
      .from('messages')
      .select('id')
      .eq('message_id', msg.replyToMid)
      .eq('conversation_id', conversation.id)
      .maybeSingle()
    replyToInternalId = parent?.id ?? null
  }

  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  // Idempotent insert — webhook deliveries can retry, and a retry
  // replays the same platform message id. Same
  // (conversation_id, message_id) unique index (migration 037) the
  // WhatsApp route relies on.
  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: msg.contentType,
        content_text: msg.contentText,
        media_url: msg.mediaUrl,
        message_id: msg.mid,
        status: 'delivered',
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: msg.interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')

  if (msgError) {
    console.error('[instagram inbound] error inserting message:', msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) {
    console.info('[instagram inbound] duplicate inbound message ignored (idempotent replay):', msg.mid)
    return
  }

  const { error: convError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: msg.contentText || `[${msg.contentType}]`,
  })
  if (convError) {
    console.error('[instagram inbound] error updating conversation:', convError)
  }

  await reopenClosedConversation(db, conversation)

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: msg.interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: msg.interactiveReplyId,
          reply_title: msg.contentText ?? '',
          meta_message_id: msg.mid,
        }
      : {
          kind: 'text',
          text: msg.contentText ?? '',
          meta_message_id: msg.mid,
        },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const inboundText = msg.contentText ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
    if (msg.interactiveReplyId) {
      automationTriggers.push('interactive_reply')
    }
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: msg.interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  if (!flowConsumed && !msg.interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    })
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: msg.mid,
    content_type: msg.contentType,
    text: msg.contentText,
    channel: 'instagram',
  })
}
