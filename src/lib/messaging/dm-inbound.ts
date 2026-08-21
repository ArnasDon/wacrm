/**
 * Provider-agnostic inbound DM handling — contact/conversation
 * resolution, idempotent message persistence, and the flows/automations/
 * AI-reply/outbound-webhook fan-out. Shared by every "Meta-style DM"
 * channel (Instagram, Facebook Messenger), each of whose webhook
 * routes (Meta-direct or Zernio) normalize their own payload shape
 * into `InboundDmMessage` and call `handleInboundDmMessage` once.
 *
 * Originally extracted from `src/app/api/instagram/webhook/route.ts`
 * (the Meta-direct Instagram webhook) as `@/lib/instagram/inbound`,
 * then generalized here to also serve Facebook — the two channels'
 * downstream handling (contact/conversation/message shape, flows,
 * automations, AI auto-reply, outbound webhook events) is identical;
 * only the contact identity column differs.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findExistingInstagramContact,
  findExistingFacebookContact,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export type DmChannel = 'instagram' | 'facebook'

/** Which `contacts` columns anchor each channel's identity. */
const CONTACT_COLUMNS: Record<DmChannel, { id: string; username: string }> = {
  instagram: { id: 'instagram_id', username: 'instagram_username' },
  facebook: { id: 'facebook_id', username: 'facebook_username' },
}

/** Per-channel exact-match contact lookup — see each function's own doc comment in dedupe.ts. */
const findExistingContact: Record<
  DmChannel,
  (db: SupabaseClient, accountId: string, externalId: string) => Promise<ExistingContact | null>
> = {
  instagram: findExistingInstagramContact,
  facebook: findExistingFacebookContact,
}

export interface InboundDmMessage {
  channel: DmChannel
  accountId: string
  configOwnerUserId: string
  /** Sender's platform-scoped id (IGSID for Instagram, PSID for Facebook). */
  senderId: string
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
   * such concept — the contact's platform id is enough to send there.
   */
  zernioConversationId?: string
  /**
   * Best-effort profile lookup for contact creation. Never throws —
   * return null on any failure.
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
  channel: DmChannel,
  accountId: string,
  configOwnerUserId: string,
  senderId: string,
  resolveProfile: () => Promise<{ name?: string; username?: string } | null>,
): Promise<ContactOutcome | null> {
  const { id: idColumn, username: usernameColumn } = CONTACT_COLUMNS[channel]

  const existingContact = await findExistingContact[channel](db, accountId, senderId)
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
      [idColumn]: senderId,
      [usernameColumn]: profile?.username ?? null,
      name: profile?.name || profile?.username || senderId,
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact[channel](db, accountId, senderId)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error(`[${channel} inbound] error creating contact:`, createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  db: SupabaseClient,
  channel: DmChannel,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error(`[${channel} inbound] error finding conversation:`, findError)
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
      channel,
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
    console.error(`[${channel} inbound] error creating conversation:`, createError)
    return null
  }

  return { conversation: newConv, created: true }
}

/** Mirror a read receipt onto `messages.status`, shared by every DM webhook route. */
export async function markMessageRead(db: SupabaseClient, platformMessageId: string): Promise<void> {
  const { error } = await db.from('messages').update({ status: 'read' }).eq('message_id', platformMessageId)
  if (error) {
    console.error('[dm inbound] error updating message read status:', error)
  }
}

export async function handleInboundDmMessage(db: SupabaseClient, msg: InboundDmMessage): Promise<void> {
  const { channel, accountId, configOwnerUserId } = msg

  const contactOutcome = await findOrCreateContact(db, channel, accountId, configOwnerUserId, msg.senderId, msg.resolveProfile)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(db, channel, accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  if (convResult.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
      channel,
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
    console.error(`[${channel} inbound] error inserting message:`, msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) {
    console.info(`[${channel} inbound] duplicate inbound message ignored (idempotent replay):`, msg.mid)
    return
  }

  const { error: convError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: msg.contentText || `[${msg.contentType}]`,
  })
  if (convError) {
    console.error(`[${channel} inbound] error updating conversation:`, convError)
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
  if (contactOutcome.wasCreated) {
    automationTriggers.unshift('new_contact_created')
    await dispatchWebhookEvent(db, accountId, 'contact.created', {
      contact_id: contactRecord.id,
      phone: contactRecord.phone,
      name: contactRecord.name,
      source: channel,
    })
  }
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
    channel,
  })
}

// ============================================================
// Outbound-from-outside-wacrm messages ("echoes") — an agent replying
// to a customer from the native Instagram/Facebook app or Meta's own
// inbox, instead of wacrm's own compose box. Meta's webhook (and
// Zernio's) still tells us about these; every DM route used to drop
// them unconditionally on the theory that they always mirror a send
// wacrm itself just made (already persisted by send-message.ts) — true
// only when the send actually went through wacrm. When it didn't, that
// dropped the ENTIRE message: no row, no conversation bump, nothing —
// which is exactly what silently hid these chats from the CRM.
//
// Both entry points below persist the message as `sender_type: 'agent'`
// and deliberately skip reopening a closed conversation, flows,
// automations, and AI auto-reply — those all exist to react to the
// CUSTOMER's own messages, not to an agent's own reply back to one.
// The idempotent (conversation_id, message_id) upsert makes it safe to
// call even when wacrm DID send the message itself: that echo's mid
// already matches the row send-message.ts inserted, so this simply
// no-ops instead of creating a duplicate.
// ============================================================

interface OutboundEchoFields {
  mid: string
  contentText: string | null
  mediaUrl: string | null
  contentType: string
  replyToMid: string | null
}

async function persistOutboundEchoMessage(
  db: SupabaseClient,
  channel: DmChannel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversation: any,
  fields: OutboundEchoFields,
): Promise<void> {
  let replyToInternalId: string | null = null
  if (fields.replyToMid) {
    const { data: parent } = await db
      .from('messages')
      .select('id')
      .eq('message_id', fields.replyToMid)
      .eq('conversation_id', conversation.id)
      .maybeSingle()
    replyToInternalId = parent?.id ?? null
  }

  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: fields.contentType,
        content_text: fields.contentText,
        media_url: fields.mediaUrl,
        message_id: fields.mid,
        status: 'sent',
        reply_to_message_id: replyToInternalId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')

  if (msgError) {
    console.error(`[${channel} outbound-echo] error inserting message:`, msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) {
    // Either a genuine retry of an echo already recorded, or — just as
    // likely — wacrm's own send-message.ts already inserted this exact
    // (conversation_id, message_id) because it made the send itself.
    // Either way, correctly a no-op.
    return
  }

  await db
    .from('conversations')
    .update({
      last_message_text: fields.contentText || `[${fields.contentType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  // No outbound webhook event here — `dispatchWebhookEvent`'s type
  // covers `message.received` (customer-originated) and
  // `message.status_updated` (delivery receipts) only; neither fits an
  // agent's own external-app send, and adding a new event type is a
  // separate product decision (would need every existing webhook
  // subscriber to consider whether they even want it) outside this
  // fix's scope of "make the message show up in the CRM at all."
  console.info(`[${channel} outbound-echo] recorded agent message from outside wacrm:`, fields.mid)
}

export interface OutboundEchoByCustomerId extends OutboundEchoFields {
  channel: DmChannel
  accountId: string
  configOwnerUserId: string
  /** The customer's platform-scoped id — Meta's `recipient.id` on an
   *  echo event (swapped from the usual `sender.id` position, since
   *  for an echo WE are the sender). */
  customerId: string
  resolveProfile: () => Promise<{ name?: string; username?: string } | null>
}

/**
 * Meta-direct entry point (Instagram's own `is_echo` events carry a
 * real customer id, unlike Zernio's — see
 * `handleOutboundEchoMessageForZernioConversation` below). Resolves/
 * creates the contact + conversation exactly like a genuine inbound
 * message would, so a brand-new contact who's only ever been messaged
 * by an agent from the native app still shows up.
 */
export async function handleOutboundEchoMessage(db: SupabaseClient, msg: OutboundEchoByCustomerId): Promise<void> {
  const { channel, accountId, configOwnerUserId } = msg

  const contactOutcome = await findOrCreateContact(db, channel, accountId, configOwnerUserId, msg.customerId, msg.resolveProfile)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(db, channel, accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  if (convResult.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
      channel,
    })
  }

  await persistOutboundEchoMessage(db, channel, conversation, msg)
}

/**
 * Zernio entry point. Unlike Meta's Send API, Zernio addresses an
 * existing *conversation* by its own opaque id rather than a raw
 * platform recipient id (see `src/lib/zernio/api.ts`'s own doc
 * comment) — so an outgoing-direction `message.received` event carries
 * no customer identifier to create a brand-new contact from. Only
 * works when a conversation already exists for `zernioConversationId`
 * (the common case: an ongoing chat the customer already started, that
 * an agent is now also replying to from outside wacrm). When none
 * exists yet, this can't know who the message was even sent to, so it
 * logs and does nothing rather than guess or fabricate a contact.
 */
export async function handleOutboundEchoMessageForZernioConversation(
  db: SupabaseClient,
  args: OutboundEchoFields & {
    channel: DmChannel
    accountId: string
    zernioConversationId: string
  },
): Promise<void> {
  const { channel, accountId, zernioConversationId } = args

  const { data: conversation, error } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('zernio_conversation_id', zernioConversationId)
    .maybeSingle()

  if (error) {
    console.error(`[${channel} outbound-echo] error looking up conversation for zernio_conversation_id:`, zernioConversationId, error)
    return
  }
  if (!conversation) {
    console.warn(
      `[${channel} outbound-echo] no existing conversation for zernio_conversation_id ${zernioConversationId} — an agent's own external-app message to a brand-new contact can't be attributed without a customer id, skipping.`,
    )
    return
  }

  await persistOutboundEchoMessage(db, channel, conversation, args)
}
