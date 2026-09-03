import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { verifyZernioWebhookSignature } from '@/lib/zernio/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { handleStatusUpdate } from '@/app/api/whatsapp/webhook/route'
import { handleTemplateWebhookChange } from '@/lib/whatsapp/template-webhook'
import { handleOutboundEchoMessageForZernioConversation } from '@/lib/messaging/dm-inbound'

// Same reasoning as the other Zernio webhook routes: after() can fan
// out to several DB round-trips per inbound message.
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// ============================================================
// Zernio inbox webhook envelope for WhatsApp — see
// https://docs.zernio.com/webhooks/inbox and
// https://docs.zernio.com/webhooks/whatsapp. Broader event surface
// than Instagram/Facebook's Zernio routes: WhatsApp has a full
// delivered/read/failed status ladder (no such thing on IG/FB
// message.received-only) and its own template-review webhook.
//
// Scope note: this covers text + media messages, the status ladder,
// and template status updates — the send/receive core most accounts
// need. Not yet handled: reaction.received, interactive button/list
// tap parsing (Zernio's `metadata` field on message.received),
// location messages, and broadcast-reply flagging
// (flagBroadcastReplyIfAny, a broadcast-analytics nicety) — same kind
// of scope boundary already drawn on the Instagram/Facebook Zernio
// routes for quick-reply taps.
// ============================================================

interface ZernioWebhookAttachment {
  type: string
  url: string
  /** WhatsApp only — the mediaId to pass to GET /v1/whatsapp/media/{mediaId}. */
  payload?: { id?: string }
}

interface ZernioWebhookSender {
  id: string
  name?: string
  phoneNumber?: string | null
}

interface ZernioWebhookMessage {
  id: string
  conversationId: string
  platform: string
  platformMessageId: string
  direction: 'incoming' | 'outgoing'
  text: string | null
  attachments: ZernioWebhookAttachment[]
  sender: ZernioWebhookSender
  /**
   * `message.sent` only — set to `'whatsapp_business_app'` for a
   * Coexistence echo (an agent replying from the official WhatsApp
   * Business app instead of wacrm). Per Zernio support (2026-08-21):
   * `message.received` never carries WhatsApp echoes at all (it's
   * inbound-from-customer only, unlike Instagram/Facebook's
   * `message.received` which does carry `direction: 'outgoing'`
   * echoes) — those are reported on the separate `message.sent` event
   * instead, which also fires for wacrm's own API-driven sends
   * (presumably under a different `source`), so this field is what
   * actually distinguishes the two, not `direction`.
   */
  source?: string
}

interface ZernioWebhookAccount {
  id: string
  accountId?: string
  platform: string
}

interface ZernioWebhookTemplate {
  templateId: string
  name: string
  language: string
  status: string
  reason: string
}

/** `conversation.started` payload — fires once, the moment a Zernio
 *  conversation is created, for either side's first message. Unlike
 *  `message.sent`'s outgoing-echo shape, this carries a real customer
 *  identifier (`participantId` — the phone number for WhatsApp) even
 *  when nothing has been received from them yet, which is exactly
 *  what's missing when an agent messages a brand-new contact first
 *  from the official WhatsApp app. */
interface ZernioWebhookConversation {
  id: string
  platform: string
  platformConversationId: string
  participantId: string
  participantName?: string
  participantUsername?: string
  status: string
}

interface ZernioWebhookPayload {
  id: string
  event: string
  message?: ZernioWebhookMessage
  account?: ZernioWebhookAccount
  template?: ZernioWebhookTemplate
  conversation?: ZernioWebhookConversation
  statusAt?: string
  error?: { code?: string; title?: string; message?: string } | null
  /** `message.sent` fallback — some Zernio events carry `source` on the envelope rather than nested under `message`. */
  source?: string
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-zernio-signature')

  let payload: ZernioWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const zernioAccountId = payload.account?.accountId ?? payload.account?.id
  if (!zernioAccountId) {
    return NextResponse.json({ error: 'Missing account in payload' }, { status: 400 })
  }

  // Zernio has no per-platform webhook scoping — a webhook registered
  // for WhatsApp still receives every Instagram/Facebook event on the
  // same account too (confirmed 2026-08-25 by inspecting a "failed"
  // delivery's raw payload: an Instagram message.received landing on
  // this endpoint). Returning 404 for those (the old behavior, since
  // they'll never match a whatsapp_config row) made Zernio's own
  // endpoint-health circuit breaker trip on the OTHER platforms'
  // traffic and suppress delivery of genuine WhatsApp events riding
  // the same webhook — the actual cause of WhatsApp messages silently
  // not reaching wacrm. Acking these as 200 keeps this endpoint's
  // reported health accurate.
  if (payload.account?.platform && payload.account.platform !== 'whatsapp') {
    return NextResponse.json({ status: 'ignored', reason: 'not a whatsapp event' }, { status: 200 })
  }

  const { data: config, error: configError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'zernio')
    .eq('zernio_account_id', zernioAccountId)
    .maybeSingle()

  if (configError) {
    console.error('[whatsapp zernio webhook] error fetching whatsapp_config:', configError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  if (!config) {
    console.error('[whatsapp zernio webhook] no whatsapp_config found for zernio_account_id:', zernioAccountId)
    return NextResponse.json({ error: 'Unknown account' }, { status: 404 })
  }

  if (!config.zernio_webhook_secret) {
    console.error('[whatsapp zernio webhook] account has no webhook secret configured:', zernioAccountId)
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 })
  }

  let secret: string
  try {
    secret = decrypt(config.zernio_webhook_secret)
  } catch (err) {
    console.error('[whatsapp zernio webhook] failed to decrypt webhook secret:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!verifyZernioWebhookSignature(rawBody, signature, secret)) {
    console.warn('[whatsapp zernio webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  after(async () => {
    try {
      await processZernioEvent(payload, config)
    } catch (error) {
      console.error('[whatsapp zernio webhook] error processing event:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processZernioEvent(payload: ZernioWebhookPayload, config: any) {
  if (payload.event === 'whatsapp.template.status_updated' && payload.template) {
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: payload.template.status,
          message_template_id: payload.template.templateId,
          message_template_name: payload.template.name,
          message_template_language: payload.template.language,
          reason: payload.template.reason,
        },
      },
      supabaseAdmin(),
    )
    return
  }

  // `conversation.started` fires once, the instant a Zernio conversation
  // is created — for either side's first message. Real incident
  // (2026-08-25): an agent messaged a brand-new contact first from the
  // official WhatsApp app, and it never showed up in wacrm at all — the
  // Coexistence echo (message.sent, below) had no existing conversation
  // to attach to and, correctly per its own design, refused to guess a
  // contact from a bare Zernio conversation id. This event is the fix:
  // it carries a real customer identifier (`participantId`, the phone
  // number) even before anything has been received from them, so the
  // contact + conversation can exist *before* that echo arrives.
  if (payload.event === 'conversation.started' && payload.conversation) {
    await processConversationStarted(payload.conversation, config)
    return
  }

  if (
    (payload.event === 'message.delivered' || payload.event === 'message.read' || payload.event === 'message.failed') &&
    payload.message
  ) {
    const statusByEvent: Record<string, string> = {
      'message.delivered': 'delivered',
      'message.read': 'read',
      'message.failed': 'failed',
    }
    const statusAt = payload.statusAt ? new Date(payload.statusAt) : new Date()
    await handleStatusUpdate({
      id: payload.message.platformMessageId,
      status: statusByEvent[payload.event],
      timestamp: String(Math.floor(statusAt.getTime() / 1000)),
      recipient_id: payload.message.sender.id,
    }, config.account_id)
    return
  }

  // Coexistence echo: an agent replied from the official WhatsApp
  // Business app instead of wacrm. Confirmed with Zernio support
  // (2026-08-21) that this is its own event — WhatsApp's
  // `message.received` is inbound-from-customer only and never
  // carries these (unlike Instagram/Facebook, where the same kind of
  // echo *does* arrive as `message.received` with `direction:
  // 'outgoing'` — see the sibling Zernio routes for that shape).
  // `message.sent` also fires for wacrm's own API-driven sends, which
  // must NOT be persisted here: send-message.ts already inserted that
  // row under Zernio's own internal send-response id, not
  // `platformMessageId`, so the idempotent upsert in
  // persistOutboundEchoMessage would not catch it as a duplicate —
  // gating strictly on `source === 'whatsapp_business_app'` is what
  // keeps this to true Coexistence echoes only.
  if (payload.event === 'message.sent' && payload.message) {
    const message = payload.message
    const source = message.source ?? payload.source
    if (source !== 'whatsapp_business_app') {
      console.info(
        '[whatsapp zernio webhook] ignoring message.sent with source:',
        source,
        '— message fields:',
        Object.keys(message).join(','),
        '— payload fields:',
        Object.keys(payload).join(','),
      )
      return
    }
    const attachment = message.attachments?.[0]
    const mediaId = attachment?.payload?.id
    await handleOutboundEchoMessageForZernioConversation(supabaseAdmin(), {
      channel: 'whatsapp',
      accountId: config.account_id,
      whatsappConfigId: config.id,
      zernioConversationId: message.conversationId,
      mid: message.platformMessageId,
      contentText: attachment ? null : message.text,
      mediaUrl: mediaId ? `/api/whatsapp/media/${mediaId}` : null,
      contentType: attachment ? toContentType(attachment.type) : 'text',
      replyToMid: null,
    })
    return
  }

  if (payload.event !== 'message.received' || !payload.message) return

  const message = payload.message
  if (message.direction !== 'incoming') return

  await processInboundMessage(message, config)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

async function findOrCreateContact(accountId: string, configOwnerUserId: string, phone: string, name: string) {
  const existingContact = await findExistingContact(supabaseAdmin(), accountId, phone)
  if (existingContact) {
    // Same self-heal as the direct Meta webhook: if this only matched
    // via the fuzzy last-8-digit comparison (e.g. a manually-entered
    // contact missing its country code), replace the stored phone
    // with the fully-qualified number Zernio just gave us, instead of
    // letting the malformed value keep breaking future outbound sends.
    const updates: Record<string, unknown> = {}
    if (name && name !== existingContact.name) updates.name = name
    if (normalizePhone(phone) !== normalizePhone(existingContact.phone)) updates.phone = phone
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin()
        .from('contacts')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact as ContactRow, wasCreated: false }
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({ account_id: accountId, user_id: configOwnerUserId, phone, name: name || phone })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced as ContactRow, wasCreated: false }
    }
    console.error('[whatsapp zernio webhook] error creating contact:', createError)
    return null
  }

  return { contact: newContact as ContactRow, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  whatsappConfigId: string,
  zernioConversationId: string | null,
) {
  // Match on Zernio's own conversation id first — it is stable across a
  // number reconnect, which mints a brand-new `whatsapp_config` row.
  // Without this, a reconnect makes the `whatsapp_config_id` filter
  // below miss the pre-reconnect thread and start a duplicate one; that
  // duplicate then broke Coexistence-echo persistence account-wide,
  // because the echo path looks a conversation up by `zernio_conversation_id`
  // alone and a second match made it bail (2026-08-29 incident).
  if (zernioConversationId) {
    const { data: byZid, error: zidError } = await supabaseAdmin()
      .from('conversations')
      .select('*')
      .eq('account_id', accountId)
      .eq('zernio_conversation_id', zernioConversationId)
      .order('created_at', { ascending: true })
      .limit(1)

    if (zidError) {
      console.error('[whatsapp zernio webhook] error finding conversation by zernio id:', zidError)
      return null
    }
    if (byZid && byZid.length > 0) {
      const conv = byZid[0]
      // Adopt the live config onto a row that predates it (or was
      // created under a now-replaced connection). If a stray duplicate
      // already holds that (account, contact, config) slot the unique
      // index will reject this — fall through and use the row as-is
      // rather than fail the whole inbound message.
      if (conv.whatsapp_config_id !== whatsappConfigId) {
        const { error: adoptError } = await supabaseAdmin()
          .from('conversations')
          .update({ whatsapp_config_id: whatsappConfigId })
          .eq('id', conv.id)
        if (adoptError) {
          console.error('[whatsapp zernio webhook] could not adopt config onto conversation', conv.id, adoptError)
        } else {
          conv.whatsapp_config_id = whatsappConfigId
        }
      }
      return { conversation: conv, created: false }
    }
  }

  // Scoped to the number the message arrived on — see the Meta webhook's
  // identical comment for why (one thread per contact per number).
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('whatsapp_config_id', whatsappConfigId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[whatsapp zernio webhook] error finding conversation:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
      channel: 'whatsapp',
      whatsapp_config_id: whatsappConfigId,
      zernio_conversation_id: zernioConversationId,
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      // Lost a race — another concurrent inbound already created the row.
      // It may collide on either unique index: (account, contact, config)
      // or (account, zernio_conversation_id) — try both.
      let racedQuery = supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
        .limit(1)
      racedQuery = zernioConversationId
        ? racedQuery.eq('zernio_conversation_id', zernioConversationId)
        : racedQuery.eq('contact_id', contactId).eq('whatsapp_config_id', whatsappConfigId)
      const { data: raced } = await racedQuery
      if (raced && raced.length > 0) return { conversation: raced[0], created: false }
    }
    console.error('[whatsapp zernio webhook] error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processConversationStarted(conversation: ZernioWebhookConversation, config: any) {
  const accountId = config.account_id
  const configOwnerUserId = config.user_id
  const senderPhone = normalizePhone(conversation.participantId)
  const contactName = conversation.participantName || conversation.participantUsername || senderPhone

  const contactOutcome = await findOrCreateContact(accountId, configOwnerUserId, senderPhone, contactName)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactRecord.id, config.id, conversation.id)
  if (!convResult) return
  const conv = convResult.conversation

  // Same self-healing check `processInboundMessage` already does —
  // needed here too since this is often the FIRST thing to run for a
  // brand-new conversation, before any inbound message ever arrives.
  if (conv.zernio_conversation_id !== conversation.id) {
    await supabaseAdmin()
      .from('conversations')
      .update({ zernio_conversation_id: conversation.id })
      .eq('id', conv.id)
  }

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conv.id,
      contact_id: contactRecord.id,
      channel: 'whatsapp',
    })
  }
  if (contactOutcome.wasCreated) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'contact.created', {
      contact_id: contactRecord.id,
      phone: contactRecord.phone,
      name: contactRecord.name,
      source: 'whatsapp',
    })
  }
}

const ALLOWED_CONTENT_TYPES = new Set(['text', 'image', 'document', 'audio', 'video'])

function toContentType(attachmentType: string): string {
  if (attachmentType === 'file') return 'document'
  if (attachmentType === 'sticker') return 'image'
  return ALLOWED_CONTENT_TYPES.has(attachmentType) ? attachmentType : 'text'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processInboundMessage(message: ZernioWebhookMessage, config: any) {
  const accountId = config.account_id
  const configOwnerUserId = config.user_id
  const senderPhone = normalizePhone(message.sender.phoneNumber || message.sender.id)
  const contactName = message.sender.name || senderPhone

  const contactOutcome = await findOrCreateContact(accountId, configOwnerUserId, senderPhone, contactName)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactRecord.id, config.id, message.conversationId)
  if (!convResult) return
  const conversation = convResult.conversation

  // `findOrCreateConversation` now stamps `zernio_conversation_id` on
  // brand-new and adopted rows, but a conversation created before that
  // (or by some other path) can still be sitting at null — and every
  // WhatsApp send via Zernio addresses a conversation by this id
  // (`requireZernioConversation` in zernio-send.ts), so a row stuck at
  // null could receive messages fine but never send a reply. Keep the
  // self-heal so such a row fixes itself on its very next inbound.
  if (message.conversationId && conversation.zernio_conversation_id !== message.conversationId) {
    await supabaseAdmin()
      .from('conversations')
      .update({ zernio_conversation_id: message.conversationId })
      .eq('id', conversation.id)
    conversation.zernio_conversation_id = message.conversationId
  }

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
      channel: 'whatsapp',
    })
  }

  const attachment = message.attachments?.[0]
  const contentText: string | null = attachment ? null : message.text
  let mediaUrl: string | null = null
  let contentType = 'text'
  if (attachment) {
    contentType = toContentType(attachment.type)
    const mediaId = attachment.payload?.id
    // Same proxy convention as the Meta-direct route (`/api/whatsapp/media/{mediaId}`)
    // — the route resolves the right provider (Meta vs Zernio) from
    // whatsapp_config at fetch time, so `messages.media_url` needs no
    // provider hint. No mediaId (malformed payload) drops the media
    // silently rather than failing the whole inbound message.
    mediaUrl = mediaId ? `/api/whatsapp/media/${mediaId}` : null
  }

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { data: insertedRows, error: msgError } = await supabaseAdmin()
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: message.platformMessageId,
        status: 'delivered',
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')

  if (msgError) {
    console.error('[whatsapp zernio webhook] error inserting message:', msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) {
    console.info('[whatsapp zernio webhook] duplicate inbound message ignored:', message.platformMessageId)
    return
  }

  const { error: convError } = await supabaseAdmin().rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: contentText || `[${contentType}]`,
  })
  if (convError) {
    console.error('[whatsapp zernio webhook] error updating conversation:', convError)
  }

  await reopenClosedConversation(supabaseAdmin(), conversation)

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: { kind: 'text', text: contentText ?? '', meta_message_id: message.platformMessageId },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const inboundText = contentText ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) {
    automationTriggers.unshift('new_contact_created')
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'contact.created', {
      contact_id: contactRecord.id,
      phone: contactRecord.phone,
      name: contactRecord.name,
      source: 'whatsapp',
    })
  }
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: { message_text: inboundText, conversation_id: conversation.id },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  if (!flowConsumed && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    })
  }

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: message.platformMessageId,
    content_type: contentType,
    text: contentText,
    // Zernio doesn't parse quick-reply/list taps into a stable id yet
    // (see the file header) — always null here. The CSAT capture hook
    // falls back to a bare-rating text match for this path.
    interactive_reply_id: null,
    channel: 'whatsapp',
  })
}
