import 'server-only'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type {
  ContactDoc,
  ConversationDoc,
  MessageDoc,
  MessageSender,
  WhatsAppConfigDoc,
} from '@/lib/db/types'
import { decrypt } from '@/lib/security/secrets'
import { NotFoundError, ValidationError } from '@/lib/http/errors'
import {
  sendDocumentById,
  sendMediaMessage,
  sendTextMessage,
  uploadMedia,
} from './meta-api'
import { toWhatsAppNumber } from './phone-utils'

// ============================================================
// WhatsApp conversation store (MongoDB) + outbound sending.
//
// All reads/writes are tenant-scoped via the caller's context.
// Sandbox contacts (created by the sales-rep playground) never
// hit Meta — outbound messages are just recorded — so the whole
// AI sales flow can be exercised without a WhatsApp number.
// ============================================================

export interface WhatsAppCredentials {
  phoneNumberId: string
  accessToken: string
}

export async function getWhatsAppCredentials(ctx: AuthContext): Promise<WhatsAppCredentials | null> {
  const configs = await scopedCollection<WhatsAppConfigDoc>(ctx, 'whatsapp_configs')
  const cfg = await configs.findOne({})
  if (!cfg) return null
  return { phoneNumberId: cfg.phoneNumberId, accessToken: decrypt(cfg.accessTokenEnc) }
}

export async function upsertContactByPhone(
  ctx: AuthContext,
  rawPhone: string,
  profileName: string | null,
  opts: { isSandbox?: boolean } = {},
): Promise<ContactDoc> {
  const phone = toWhatsAppNumber(rawPhone)
  if (!/^\d{7,15}$/.test(phone)) throw new ValidationError('Invalid phone number')
  const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
  const contact = await contacts.findOneAndUpdate(
    { phone },
    {
      $setOnInsert: {
        phone,
        name: profileName,
        email: null,
        notes: null,
        tags: [],
        isSandbox: !!opts.isSandbox,
      },
    },
    { upsert: true },
  )
  if (!contact) throw new Error('contact upsert failed')
  // Fill a missing name from the WhatsApp profile without overwriting
  // a name an agent typed in.
  if (!contact.name && profileName) {
    await contacts.updateById(contact._id, { $set: { name: profileName } })
    contact.name = profileName
  }
  return contact
}

export async function getOrCreateConversation(ctx: AuthContext, contactId: string): Promise<ConversationDoc> {
  const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
  const now = new Date()
  const conv = await conversations.findOneAndUpdate(
    { contactId },
    {
      $setOnInsert: {
        contactId,
        status: 'open',
        assignedUserId: null,
        lastMessageAt: now,
        lastMessagePreview: null,
        lastInboundAt: null,
        unreadCount: 0,
        aiPaused: false,
        aiPausedReason: null,
      },
    },
    { upsert: true },
  )
  if (!conv) throw new Error('conversation upsert failed')
  return conv
}

function preview(text: string | null, type: MessageDoc['type']): string {
  if (text) return text.slice(0, 140)
  return type === 'document' ? '📄 Document' : type === 'image' ? '📷 Photo' : `[${type}]`
}

/** Record an inbound customer message. Returns null for duplicates (Meta retries). */
export async function recordInbound(
  ctx: AuthContext,
  input: {
    conversation: ConversationDoc
    type: MessageDoc['type']
    text: string | null
    waMessageId: string | null
    media?: MessageDoc['media']
    at?: Date
  },
): Promise<MessageDoc | null> {
  const messages = await scopedCollection<MessageDoc>(ctx, 'messages')
  let msg: MessageDoc
  try {
    msg = await messages.insertOne({
      conversationId: input.conversation._id,
      contactId: input.conversation.contactId,
      direction: 'inbound',
      sender: 'customer',
      senderUserId: null,
      type: input.type,
      text: input.text,
      media: input.media ?? null,
      waMessageId: input.waMessageId,
      status: 'received',
      error: null,
    })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null // already processed
    throw err
  }
  const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
  const at = input.at ?? new Date()
  await conversations.updateById(input.conversation._id, {
    $set: {
      lastMessageAt: at,
      lastInboundAt: at,
      lastMessagePreview: preview(input.text, input.type),
      status: 'open',
    },
    $inc: { unreadCount: 1 },
  })
  return msg
}

async function loadConversationTarget(ctx: AuthContext, conversationId: string) {
  const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
  const conversation = await conversations.findById(conversationId)
  if (!conversation) throw new NotFoundError('Conversation not found')
  const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
  const contact = await contacts.findById(conversation.contactId)
  if (!contact) throw new NotFoundError('Contact not found')
  return { conversation, contact }
}

async function recordOutbound(
  ctx: AuthContext,
  conversation: ConversationDoc,
  fields: Pick<MessageDoc, 'type' | 'text' | 'media' | 'sender' | 'senderUserId' | 'waMessageId' | 'status' | 'error'>,
): Promise<MessageDoc> {
  const messages = await scopedCollection<MessageDoc>(ctx, 'messages')
  const msg = await messages.insertOne({
    conversationId: conversation._id,
    contactId: conversation.contactId,
    direction: 'outbound',
    ...fields,
  })
  const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
  await conversations.updateById(conversation._id, {
    $set: { lastMessageAt: new Date(), lastMessagePreview: preview(fields.text, fields.type) },
  })
  return msg
}

/**
 * Send a text message on a conversation and record it. Never throws
 * for delivery failures — the message is stored with status
 * 'failed' and the error, so the inbox shows what happened.
 */
export async function sendText(
  ctx: AuthContext,
  conversationId: string,
  text: string,
  sender: MessageSender,
  senderUserId: string | null = null,
): Promise<MessageDoc> {
  const body = text.slice(0, 4096)
  const { conversation, contact } = await loadConversationTarget(ctx, conversationId)
  if (contact.isSandbox) {
    return recordOutbound(ctx, conversation, {
      type: 'text', text: body, media: null, sender, senderUserId,
      waMessageId: null, status: 'sent', error: null,
    })
  }
  const creds = await getWhatsAppCredentials(ctx)
  if (!creds) {
    return recordOutbound(ctx, conversation, {
      type: 'text', text: body, media: null, sender, senderUserId,
      waMessageId: null, status: 'failed', error: 'WhatsApp is not connected (Settings → WhatsApp)',
    })
  }
  try {
    const { messageId } = await sendTextMessage({ ...creds, to: contact.phone, text: body })
    return recordOutbound(ctx, conversation, {
      type: 'text', text: body, media: null, sender, senderUserId,
      waMessageId: messageId, status: 'sent', error: null,
    })
  } catch (err) {
    return recordOutbound(ctx, conversation, {
      type: 'text', text: body, media: null, sender, senderUserId,
      waMessageId: null, status: 'failed', error: (err as Error).message.slice(0, 300),
    })
  }
}

/** Send a generated PDF (invoice/receipt) as a WhatsApp document. */
export async function sendPdf(
  ctx: AuthContext,
  conversationId: string,
  pdf: Uint8Array,
  filename: string,
  caption: string,
  href: string,
  sender: MessageSender,
): Promise<MessageDoc> {
  const { conversation, contact } = await loadConversationTarget(ctx, conversationId)
  const media = { id: null as string | null, mime: 'application/pdf', filename, href }
  if (contact.isSandbox) {
    return recordOutbound(ctx, conversation, {
      type: 'document', text: caption, media, sender, senderUserId: null,
      waMessageId: null, status: 'sent', error: null,
    })
  }
  const creds = await getWhatsAppCredentials(ctx)
  if (!creds) {
    return recordOutbound(ctx, conversation, {
      type: 'document', text: caption, media, sender, senderUserId: null,
      waMessageId: null, status: 'failed', error: 'WhatsApp is not connected',
    })
  }
  try {
    const { mediaId } = await uploadMedia({ ...creds, data: pdf, mimeType: 'application/pdf', filename })
    const { messageId } = await sendDocumentById({ ...creds, to: contact.phone, mediaId, filename, caption })
    return recordOutbound(ctx, conversation, {
      type: 'document', text: caption, media: { ...media, id: mediaId }, sender, senderUserId: null,
      waMessageId: messageId, status: 'sent', error: null,
    })
  } catch (err) {
    return recordOutbound(ctx, conversation, {
      type: 'document', text: caption, media, sender, senderUserId: null,
      waMessageId: null, status: 'failed', error: (err as Error).message.slice(0, 300),
    })
  }
}

/**
 * Send a product photo (public Cloudinary URL — Meta fetches it by
 * link). Recorded like any other outbound message.
 */
export async function sendImage(
  ctx: AuthContext,
  conversationId: string,
  imageUrl: string,
  caption: string,
  sender: MessageSender,
): Promise<MessageDoc> {
  const { conversation, contact } = await loadConversationTarget(ctx, conversationId)
  const media = { id: null as string | null, mime: 'image/jpeg', filename: null, href: imageUrl }
  const base = { type: 'image' as const, text: caption.slice(0, 1024), media, sender, senderUserId: null }
  if (contact.isSandbox) {
    return recordOutbound(ctx, conversation, { ...base, waMessageId: null, status: 'sent', error: null })
  }
  const creds = await getWhatsAppCredentials(ctx)
  if (!creds) {
    return recordOutbound(ctx, conversation, { ...base, waMessageId: null, status: 'failed', error: 'WhatsApp is not connected' })
  }
  try {
    const { messageId } = await sendMediaMessage({ ...creds, to: contact.phone, kind: 'image', link: imageUrl, caption: base.text })
    return recordOutbound(ctx, conversation, { ...base, waMessageId: messageId, status: 'sent', error: null })
  } catch (err) {
    return recordOutbound(ctx, conversation, { ...base, waMessageId: null, status: 'failed', error: (err as Error).message.slice(0, 300) })
  }
}

export async function recentMessages(ctx: AuthContext, conversationId: string, limit = 20): Promise<MessageDoc[]> {
  const messages = await scopedCollection<MessageDoc>(ctx, 'messages')
  const rows = await messages.find({ conversationId }).sort({ createdAt: -1 }).limit(limit).toArray()
  return rows.reverse()
}
