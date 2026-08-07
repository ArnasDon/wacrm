// ============================================================
// Inbound webhook for the Evolution Go provider (unofficial,
// self-hosted WhatsApp transport — see src/lib/whatsapp/evolution-api.ts).
//
// Mirrors ../route.ts (the Meta Cloud API webhook) as closely as the
// different payload shape allows: same ack-fast-then-process-in-
// after() pattern, and the exact same downstream pipeline (dedupe,
// reopen-on-reply, flows, automations, AI auto-reply, outbound
// webhook dispatch) so a message is indistinguishable in the CRM
// regardless of which provider delivered it.
//
// Payload shape (confirmed against the Evolution Go API and a live
// reference integration consuming this same event stream — see
// migration 037 and evolution-api.ts for the outbound side):
//   { event: 'Message' | 'Receipt' | 'PairSuccess' | 'LoggedOut',
//     data: {...}, instanceId, instanceToken, state? }
//
// Auth: unlike Meta, Evolution Go does not sign requests (no
// X-Hub-Signature equivalent). We authenticate by matching
// instanceId + instanceToken against a stored whatsapp_config row —
// anyone who discovers this URL without a valid pair gets a 401
// before any DB write happens.
// ============================================================

import { NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

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
// Payload types
// ============================================================

interface EvolutionInfo {
  ID?: string
  IsFromMe?: boolean
  Type?: string
  /** JID of the chat this message belongs to — our conversation key. */
  Chat?: string
  /** Actual sender JID for group messages. */
  Sender?: string
  SenderAlt?: string
  IsGroup?: boolean
  PushName?: string
  Timestamp?: string
  MediaType?: string
}

interface EvolutionMediaPart {
  caption?: string
  mimetype?: string
  mediaUrl?: string
  fileName?: string
}

interface EvolutionMessage {
  conversation?: string
  extendedTextMessage?: {
    text?: string
    contextInfo?: { stanzaId?: string; stanzaID?: string }
  }
  /** Evolution Go hoists the decrypted media URL here regardless of type. */
  mediaUrl?: string
  base64?: string
  imageMessage?: EvolutionMediaPart
  videoMessage?: EvolutionMediaPart
  audioMessage?: EvolutionMediaPart
  documentMessage?: EvolutionMediaPart
  stickerMessage?: EvolutionMediaPart
  contextInfo?: { stanzaId?: string; stanzaID?: string }
  protocolMessage?: { type?: string }
}

interface EvolutionMessageData {
  Info?: EvolutionInfo
  Message?: EvolutionMessage
}

interface EvolutionReceiptData {
  MessageIDs?: string[]
  Type?: string
}

interface EvolutionWebhookBody {
  event?: string
  data?: Record<string, unknown>
  state?: string
  instanceId?: string
  instanceToken?: string
}

interface WhatsappConfigRow {
  id: string
  account_id: string
  user_id: string
  evolution_instance_token: string
}

// ============================================================
// Route
// ============================================================

export async function POST(request: Request) {
  let body: EvolutionWebhookBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.event || !body.data || !body.instanceId || !body.instanceToken) {
    return NextResponse.json(
      { error: 'Invalid Evolution Go webhook payload' },
      { status: 400 }
    )
  }

  const config = await findConfigForInstance(body.instanceId, body.instanceToken)
  if (!config) {
    console.warn(
      '[evolution-webhook] no whatsapp_config matched instanceId/instanceToken — rejecting'
    )
    return NextResponse.json({ error: 'Unknown instance' }, { status: 401 })
  }

  // Ack fast, process after — same reasoning as the Meta webhook route:
  // on a serverless runtime a detached promise can be frozen the moment
  // the response is sent, so background work must run inside after().
  after(async () => {
    try {
      await processEvolutionEvent(body, config)
    } catch (error) {
      console.error('[evolution-webhook] processing error:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function findConfigForInstance(
  instanceId: string,
  instanceToken: string
): Promise<WhatsappConfigRow | null> {
  const { data: rows, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, user_id, evolution_instance_token')
    .eq('provider', 'evolution')
    .eq('evolution_instance_uuid', instanceId)

  if (error) {
    console.error('[evolution-webhook] config lookup failed:', error)
    return null
  }
  if (!rows || rows.length === 0) return null
  if (rows.length > 1) {
    // Shouldn't happen — evolution_instance_uuid has a unique index
    // (migration 037) — but fail closed rather than pick one at random.
    console.error(
      `[evolution-webhook] multiple configs (${rows.length}) matched instance_uuid ${instanceId} — dropping`
    )
    return null
  }

  const config = rows[0] as WhatsappConfigRow
  let storedToken: string
  try {
    storedToken = decrypt(config.evolution_instance_token)
  } catch (err) {
    console.error('[evolution-webhook] failed to decrypt stored instance token:', err)
    return null
  }
  // instanceToken is a bearer credential (this endpoint's only auth
  // gate — see file header) — compare in constant time, same as the
  // Meta webhook's HMAC check in webhook-signature.ts, so a
  // byte-by-byte timing side-channel can't shortcut a brute force.
  const a = Buffer.from(storedToken)
  const b = Buffer.from(instanceToken)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  return config
}

async function processEvolutionEvent(
  body: EvolutionWebhookBody,
  config: WhatsappConfigRow
) {
  switch (body.event) {
    case 'Message':
      return processEvolutionMessage(body.data as EvolutionMessageData, config)
    case 'Receipt':
      return processEvolutionReceipt(body.data as EvolutionReceiptData, body.state, config)
    case 'PairSuccess':
    case 'Connected':
      // 'PairSuccess' is the initial QR pairing; 'Connected' fires on
      // every later (re)connect of an already-paired session (e.g.
      // after a brief network drop self-heals). Without handling the
      // latter, a session that recovers on its own leaves the DB
      // status stuck on 'disconnected' until someone happens to open
      // Settings and the QR-poll's status check runs.
      return supabaseAdmin()
        .from('whatsapp_config')
        .update({ status: 'connected', connected_at: new Date().toISOString() })
        .eq('id', config.id)
    case 'LoggedOut':
      return supabaseAdmin()
        .from('whatsapp_config')
        .update({ status: 'disconnected' })
        .eq('id', config.id)
    case 'Disconnected':
      // Usually transient (whatsmeow auto-reconnects — typically
      // followed by a 'Connected' event a couple seconds later).
      // Deliberately NOT flipping status here to avoid UI flicker on
      // momentary network blips; 'LoggedOut' is the authoritative
      // "actually needs re-pairing" signal. Logged for observability
      // since a burst of these can precede a real drop (e.g. Evolution
      // Go's "Maximum QR code count reached" auto-logout).
      console.warn('[evolution-webhook] instance disconnected (transient?), instanceId:', body.instanceId)
      return
    default:
      console.warn('[evolution-webhook] unhandled event type:', body.event)
  }
}

// ============================================================
// Message event
// ============================================================

function extractQuotedStanzaId(message: EvolutionMessage): string | null {
  return (
    message.extendedTextMessage?.contextInfo?.stanzaId ??
    message.extendedTextMessage?.contextInfo?.stanzaID ??
    message.contextInfo?.stanzaId ??
    message.contextInfo?.stanzaID ??
    null
  )
}

const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive',
])

function extractContent(message: EvolutionMessage): {
  contentType: string
  contentText: string | null
  mediaUrl: string | null
} | null {
  if (message.conversation) {
    return { contentType: 'text', contentText: message.conversation, mediaUrl: null }
  }
  if (message.extendedTextMessage?.text) {
    return { contentType: 'text', contentText: message.extendedTextMessage.text, mediaUrl: null }
  }

  // Evolution Go hoists the resolved media URL to Message.mediaUrl (or
  // inline Message.base64) regardless of which *Message type carries
  // it — the per-type object below only supplies the caption/mimetype.
  const mediaUrl = message.mediaUrl || null
  if (message.imageMessage) {
    return { contentType: 'image', contentText: message.imageMessage.caption || null, mediaUrl }
  }
  if (message.videoMessage) {
    return { contentType: 'video', contentText: message.videoMessage.caption || null, mediaUrl }
  }
  if (message.audioMessage) {
    return { contentType: 'audio', contentText: null, mediaUrl }
  }
  if (message.documentMessage) {
    return { contentType: 'document', contentText: message.documentMessage.caption || null, mediaUrl }
  }
  if (message.stickerMessage) {
    // Stickers have no CRM-native type — same fallback the Meta webhook
    // uses (image).
    return { contentType: 'image', contentText: null, mediaUrl }
  }
  return null
}

async function processEvolutionMessage(
  data: EvolutionMessageData | undefined,
  config: WhatsappConfigRow
) {
  const info = data?.Info
  const message = data?.Message
  if (!info || !message) return

  // protocolMessage carries revokes / other client-sync events, not a
  // real chat message — creating a row for it produced an empty bubble
  // in the reference integration. Skip entirely.
  if (message.protocolMessage) return

  // Group chats aren't modelled in wacrm's schema (contacts/conversations
  // are 1:1 with a phone number) — skip rather than half-support them.
  if (info.IsGroup) {
    console.warn('[evolution-webhook] group message received, skipping (unsupported):', info.Chat)
    return
  }

  // Messages the linked phone itself sent (outside wacrm, e.g. the
  // business owner replying from their own WhatsApp app) have no Meta
  // Cloud API equivalent — skip, same as that provider effectively does.
  if (info.IsFromMe) return

  const rawMessageId = info.ID
  const chatJid = info.Chat
  if (!rawMessageId || !chatJid) return

  const content = extractContent(message)
  if (!content) {
    console.warn('[evolution-webhook] unrecognized message content, skipping:', rawMessageId)
    return
  }

  const phone = chatJid.split('@')[0]?.replace(/:\d+$/, '')
  if (!phone) return

  const pushName = info.PushName || phone

  const contactOutcome = await findOrCreateContact(
    config.account_id,
    config.user_id,
    phone,
    pushName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contactRecord.id
  )
  if (!convResult) return
  const conversation = convResult.conversation

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), config.account_id, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  // De-dup — Evolution Go's webhook is known to redeliver on retry more
  // readily than Meta's. message_id has no DB-level unique constraint
  // (intentional — see migration 036), so check explicitly.
  const { data: dupe } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', rawMessageId)
    .eq('conversation_id', conversation.id)
    .maybeSingle()
  if (dupe) return

  let replyToInternalId: string | null = null
  const stanzaId = extractQuotedStanzaId(message)
  if (stanzaId) {
    const { data: parent } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('message_id', stanzaId)
      .eq('conversation_id', conversation.id)
      .maybeSingle()
    replyToInternalId = parent?.id ?? null
  }

  const contentType = ALLOWED_CONTENT_TYPES.has(content.contentType)
    ? content.contentType
    : 'text'

  const timestampMs = info.Timestamp ? Date.parse(info.Timestamp) : NaN
  const createdAt = Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : new Date().toISOString()

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: content.contentText,
    media_url: content.mediaUrl,
    message_id: rawMessageId,
    status: 'delivered',
    created_at: createdAt,
    reply_to_message_id: replyToInternalId,
  })
  if (msgError) {
    console.error('[evolution-webhook] error inserting message:', msgError)
    return
  }

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: content.contentText || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  await reopenClosedConversation(supabaseAdmin(), conversation)
  await flagBroadcastReplyIfAny(config.account_id, contactRecord.id)

  const inboundText = content.contentText ?? ''

  const flowResult = await dispatchInboundToFlows({
    accountId: config.account_id,
    userId: config.user_id,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: { kind: 'text', text: inboundText, meta_message_id: rawMessageId },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId: config.account_id,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  if (!flowConsumed && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId: config.account_id,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId: config.user_id,
    })
  }

  await dispatchWebhookEvent(supabaseAdmin(), config.account_id, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: rawMessageId,
    content_type: contentType,
    text: content.contentText,
  })
}

// ============================================================
// Receipt event — delivery/read status for our own outbound sends.
// ============================================================

async function processEvolutionReceipt(
  data: EvolutionReceiptData | undefined,
  state: string | undefined,
  config: WhatsappConfigRow
) {
  if (!data?.MessageIDs?.length || !state) return

  const status = state.toLowerCase() === 'read'
    ? 'read'
    : state.toLowerCase() === 'delivered'
      ? 'delivered'
      : null
  if (!status) return

  const { data: rows, error } = await supabaseAdmin()
    .from('messages')
    .select('id, status, conversation_id, conversations!inner(account_id)')
    .in('message_id', data.MessageIDs)
    .eq('conversations.account_id', config.account_id)

  if (error || !rows || rows.length === 0) return

  // Never regress read -> delivered, mirrors the Meta webhook's ladder
  // guard in spirit (a delayed duplicate receipt must not walk a
  // message's status backwards).
  const updatable = rows.filter(
    (r: { status: string }) => !(r.status === 'read' && status === 'delivered')
  )
  if (updatable.length === 0) return

  await supabaseAdmin()
    .from('messages')
    .update({ status })
    .in(
      'id',
      updatable.map((r: { id: string }) => r.id)
    )
}

// ============================================================
// Shared helpers — duplicated (not imported) from ../route.ts
// deliberately: that file's helpers are private, and this route's
// find-or-create shape is provider-agnostic enough that keeping a
// short, independent copy here is simpler than refactoring a
// 1000+ line, heavily-tested file to export them.
// ============================================================

interface ContactOutcome {
  contact: { id: string; name?: string | null; phone: string }
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingContact(supabaseAdmin(), accountId, phone)

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[evolution-webhook] error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string
) {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[evolution-webhook] error finding conversation:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({ account_id: accountId, user_id: configOwnerUserId, contact_id: contactId })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return { conversation: raced[0], created: false }
    }
    console.error('[evolution-webhook] error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('[evolution-webhook] error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('[evolution-webhook] flagBroadcastReplyIfAny failed:', err)
  }
}
