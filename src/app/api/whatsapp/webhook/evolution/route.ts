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
// migration 040 and evolution-api.ts for the outbound side):
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
import { buildMediaPath } from '@/lib/storage/upload-media'
import { extensionForMime } from '@/lib/media/filename'
import { readBodyWithLimit } from '@/lib/http/read-body-with-limit'

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
  /** Phone-number JID for `Sender`, when whatsmeow has resolved a LID mapping. */
  SenderAlt?: string
  /** Phone-number JID for the *recipient* — the one that matters when `IsFromMe` (Sender is then the agent's own account, not the chat partner). */
  RecipientAlt?: string
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

// Evolution Go inlines media as base64 in the webhook body (see
// uploadInlineMedia below), so this has to fit the largest allowed
// attachment (chat-media bucket cap: 16 MB, migration 023) plus ~34%
// base64 overhead and JSON framing — 25 MB leaves comfortable headroom
// while still bounding the pre-auth request size an anonymous caller
// can force this process to buffer.
const MAX_WEBHOOK_BODY_BYTES = 25 * 1024 * 1024

export async function POST(request: Request) {
  const bodyResult = await readBodyWithLimit(request, MAX_WEBHOOK_BODY_BYTES)
  if (!bodyResult.ok) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  let body: EvolutionWebhookBody
  try {
    body = JSON.parse(bodyResult.text)
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
    // (migration 040) — but fail closed rather than pick one at random.
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

interface ExtractedContent {
  contentType: string
  contentText: string | null
  /** Already-fetchable URL, when Evolution Go ever supplies one directly. */
  mediaUrl: string | null
  /** MIME type of the media part, for the base64 upload path below. */
  mimeType: string | null
  fileName: string | null
}

function extractContent(message: EvolutionMessage): ExtractedContent | null {
  if (message.conversation) {
    return { contentType: 'text', contentText: message.conversation, mediaUrl: null, mimeType: null, fileName: null }
  }
  if (message.extendedTextMessage?.text) {
    return { contentType: 'text', contentText: message.extendedTextMessage.text, mediaUrl: null, mimeType: null, fileName: null }
  }

  // A URL here would mean Evolution Go resolved the media server-side;
  // in practice (confirmed live) it doesn't — the decrypted bytes come
  // back inline on `message.base64` instead (see processEvolutionMessage,
  // which uploads them to Storage to produce the real media_url).
  const mediaUrl = message.mediaUrl || null
  if (message.imageMessage) {
    return {
      contentType: 'image',
      contentText: message.imageMessage.caption || null,
      mediaUrl,
      mimeType: message.imageMessage.mimetype || null,
      fileName: message.imageMessage.fileName || null,
    }
  }
  if (message.videoMessage) {
    return {
      contentType: 'video',
      contentText: message.videoMessage.caption || null,
      mediaUrl,
      mimeType: message.videoMessage.mimetype || null,
      fileName: message.videoMessage.fileName || null,
    }
  }
  if (message.audioMessage) {
    return {
      contentType: 'audio',
      contentText: null,
      mediaUrl,
      mimeType: message.audioMessage.mimetype || null,
      fileName: message.audioMessage.fileName || null,
    }
  }
  if (message.documentMessage) {
    return {
      contentType: 'document',
      contentText: message.documentMessage.caption || null,
      mediaUrl,
      mimeType: message.documentMessage.mimetype || null,
      fileName: message.documentMessage.fileName || null,
    }
  }
  if (message.stickerMessage) {
    // Stickers have no CRM-native type — same fallback the Meta webhook
    // uses (image).
    return {
      contentType: 'image',
      contentText: null,
      mediaUrl,
      mimeType: message.stickerMessage.mimetype || null,
      fileName: message.stickerMessage.fileName || null,
    }
  }
  return null
}

/**
 * Evolution Go hands back the decrypted media inline as base64 on
 * `Message.base64` rather than a fetchable URL (confirmed live —
 * `Message.mediaUrl` is never actually populated despite what the field
 * existing suggested). Upload it to the same `chat-media` bucket the
 * inbox composer's outbound attachments use, so inbound Evolution media
 * gets a real, browser-fetchable URL like every other media path in the
 * app instead of silently landing as `media_url: null`.
 */
async function uploadInlineMedia(
  accountId: string,
  base64: string,
  content: ExtractedContent
): Promise<string | null> {
  try {
    // WhatsApp reports voice notes as `audio/ogg; codecs=opus` — the
    // `chat-media` bucket's allowed_mime_types only lists the bare
    // `audio/ogg` (migration 023), and Supabase Storage matches it
    // exactly, so the parameterized form was rejected outright
    // (confirmed live: "mime type audio/ogg; codecs=opus is not
    // supported", every voice note silently dropped). Strip params —
    // extensionForMime already does this internally, but the bucket
    // upload itself was still sent the raw, unstripped value.
    const mimeType = (content.mimeType || 'application/octet-stream').split(';')[0].trim()
    const ext = extensionForMime(mimeType)
    const baseName = content.fileName || `whatsapp-${content.contentType}.${ext}`
    const path = buildMediaPath(accountId, baseName)
    const bytes = Buffer.from(base64, 'base64')

    const { error } = await supabaseAdmin()
      .storage.from('chat-media')
      .upload(path, bytes, { contentType: mimeType, upsert: false })

    if (error) {
      console.error('[evolution-webhook] media upload failed:', error)
      return null
    }

    const { data } = supabaseAdmin().storage.from('chat-media').getPublicUrl(path)
    return data?.publicUrl ?? null
  } catch (err) {
    console.error('[evolution-webhook] media upload threw:', err)
    return null
  }
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
  // `IsGroup` alone isn't reliable — some group-addressed events arrive
  // with it unset, but the `@g.us` suffix on Chat is a direct, always-
  // present signal straight from the JID, so check both.
  if (info.IsGroup || info.Chat?.endsWith('@g.us')) {
    console.warn('[evolution-webhook] group message received, skipping (unsupported):', info.Chat)
    return
  }

  // `IsFromMe` = the linked phone itself sent this (the agent replying
  // from their own WhatsApp app, outside wacrm) rather than the customer.
  // Meta Cloud API numbers are API-only with no such dual-use phone
  // client, so this case doesn't exist for that provider — but Evolution
  // Go pairs a *real* WhatsApp session, and agents do reply from the
  // phone directly. Previously this returned early and dropped the
  // message entirely, which is exactly the "sent from the phone but
  // never shows up in the CRM" desync reported live. It's now processed
  // as an agent-sent message instead of skipped further down.
  const isFromMe = Boolean(info.IsFromMe)

  const rawMessageId = info.ID
  let chatJid = info.Chat
  if (!rawMessageId || !chatJid) return

  // WhatsApp's newer "LID" addressing hides the real phone number behind
  // an opaque per-contact id (`<digits>@lid`) instead of the classic
  // `<phone>@s.whatsapp.net`. Since wacrm keys contacts by phone number,
  // treating the LID's digits as a phone number would create a bogus
  // "contact" that fragments the real person's conversation into two
  // (seen live: a contact record with phone "94103152910436", which is
  // a LID, not a number). `SenderAlt` is whatsmeow's resolved
  // phone-number JID for the same party when it has one; fall back to
  // it, and if even that's unavailable (WhatsApp hasn't disclosed the
  // number — a real possibility with this feature), skip the message
  // rather than write garbage into contacts. Which alt field resolves
  // `Chat` depends on direction: for a customer-sent message Sender ==
  // Chat, so `SenderAlt` is the right one; for an agent-sent (IsFromMe)
  // message `Chat` is the recipient, not the sender, so `RecipientAlt`
  // is the one that actually maps to it — using SenderAlt there would
  // resolve to the *agent's own* number instead of the customer's.
  if (chatJid.endsWith('@lid')) {
    const alt = isFromMe ? info.RecipientAlt : info.SenderAlt
    if (alt?.endsWith('@s.whatsapp.net')) {
      chatJid = alt
    } else {
      console.warn(
        '[evolution-webhook] LID-addressed chat with no resolvable phone number, skipping:',
        chatJid
      )
      return
    }
  }

  const content = extractContent(message)
  if (!content) {
    console.warn('[evolution-webhook] unrecognized message content, skipping:', rawMessageId)
    return
  }

  let resolvedMediaUrl = content.mediaUrl
  if (!resolvedMediaUrl && message.base64) {
    resolvedMediaUrl = await uploadInlineMedia(config.account_id, message.base64, content)
  }

  const phone = chatJid.split('@')[0]?.replace(/:\d+$/, '')
  if (!phone) return

  // `Info.PushName` is the *sender's* display name — for a customer
  // message that's exactly who `phone` above resolves to, so it's safe
  // to backfill/refresh the contact's name with it. For an `isFromMe`
  // message the sender is the agent's own linked account, so PushName
  // is the *business's own* WhatsApp display name, not the customer's
  // (confirmed live: it overwrote real customer names with the
  // account's own — "7K PRIME TV" — the moment this account replied to
  // them from the phone). Passing '' here makes findOrCreateContact
  // leave an existing contact's name alone and fall back to the phone
  // number for a brand new one, same as when PushName is simply absent.
  const pushName = isFromMe ? '' : (info.PushName || phone)

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

  // An agent-sent message that the CRM itself dispatched (send-message.ts)
  // already got its own row with this exact `message_id` (WhatsApp's own
  // id, echoed back unchanged) — the dedup check above already caught
  // that case. What lands here as `isFromMe` is genuinely new: the agent
  // replied from their own phone, outside wacrm.
  if (isFromMe) {
    const { error: msgError } = await supabaseAdmin().from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'agent',
      content_type: contentType,
      content_text: content.contentText,
      media_url: resolvedMediaUrl,
      message_id: rawMessageId,
      status: 'sent',
      created_at: createdAt,
      reply_to_message_id: replyToInternalId,
    })
    if (msgError) {
      console.error('[evolution-webhook] error inserting agent (phone) message:', msgError)
      return
    }

    await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: content.contentText || `[${contentType}]`,
        last_message_at: new Date().toISOString(),
        // Not a customer message — nothing new for an agent to triage.
        unread_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)

    await reopenClosedConversation(supabaseAdmin(), conversation)

    // Same "human stepped in" signal send-message.ts acts on when an
    // agent sends from the CRM — replying from the phone is no
    // different, so a Flow run waiting on this contact should yield too.
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', config.account_id)
      .eq('contact_id', contactRecord.id)
      .eq('status', 'active')
    if (pauseErr) {
      console.error('[evolution-webhook] pause-on-agent-phone-reply failed:', pauseErr.message)
    }

    return
  }

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
    media_url: resolvedMediaUrl,
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
