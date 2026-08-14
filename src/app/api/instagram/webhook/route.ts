import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingInstagramContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { getIgUserProfile } from '@/lib/instagram/api'

// Same reasoning as src/app/api/whatsapp/webhook/route.ts: the after()
// callback can fan out to a profile-lookup call per new contact, so
// give it headroom beyond the platform default.
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
// Instagram Messaging webhook envelope.
//
// Structurally different from WhatsApp's `entry[].changes[].value`
// shape (see the WhatsApp route) — Instagram uses
// `entry[].messaging[]`, one object per message/event, keyed by
// `sender.id` / `recipient.id` (both Instagram-Scoped IDs) rather
// than a phone_number_id + contacts array.
// ============================================================

interface InstagramAttachment {
  type: string // 'image' | 'video' | 'audio' | 'file' | ...
  payload?: { url?: string }
}

interface InstagramMessage {
  mid: string
  text?: string
  attachments?: InstagramAttachment[]
  quick_reply?: { payload: string }
  /**
   * Present when the customer swipe-replies to one of our messages.
   */
  reply_to?: { mid: string }
  /**
   * True when this event mirrors a message OUR page/app sent (via the
   * API, or manually from Meta's own inbox) rather than one from the
   * customer. Without filtering these out, every agent send would be
   * re-ingested here as a second, duplicate delivery on top of the
   * one send-message.ts already persisted — see the is_echo check in
   * processMessagingEvent below.
   */
  is_echo?: boolean
}

interface InstagramMessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: InstagramMessage
  read?: { mid: string }
}

interface InstagramWebhookEntry {
  id: string
  time?: number
  messaging?: InstagramMessagingEvent[]
}

// GET - Webhook verification. Mirrors the WhatsApp route's brute-force
// match over every connected account's config — Meta's verification
// ping carries no account-identifying info beyond the shared token.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    const { data: configs, error: configError } = await supabaseAdmin()
      .from('instagram_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError)
      return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
    }

    const matched = configs.some((config: { verify_token: string | null }) => {
      if (!config.verify_token) return false
      try {
        return decrypt(config.verify_token) === verifyToken
      } catch {
        return false
      }
    })

    if (matched) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 })
  } catch (error) {
    console.error('Error in Instagram webhook GET verification:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Receive messages. Same ack-fast-then-process pattern as the
// WhatsApp route: verify signature synchronously, defer the actual
// work into after() so Meta gets its 200 within the ~20s window,
// while the runtime keeps the function alive until the callback
// resolves (required on serverless — see the WhatsApp route's comment
// on issue #301 for why a detached promise isn't safe here).
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[instagram webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: InstagramWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('Error processing Instagram webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: InstagramWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    if (!entry.messaging) continue

    for (const event of entry.messaging) {
      // The recipient of an inbound customer message is OUR connected
      // IG account — route by that id, mirroring the WhatsApp route's
      // phone_number_id lookup. `.single()`-avoidance for the same
      // reason: distinguish "no config" from "ambiguous config" in logs.
      const igAccountId = event.recipient.id

      const { data: configRows, error: configError } = await supabaseAdmin()
        .from('instagram_config')
        .select('*')
        .eq('ig_account_id', igAccountId)

      if (configError) {
        console.error('Error fetching instagram_config for ig_account_id:', igAccountId, configError)
        continue
      }
      if (!configRows || configRows.length === 0) {
        console.error('No Instagram config found for ig_account_id:', igAccountId)
        continue
      }
      if (configRows.length > 1) {
        console.error(
          `Multiple Instagram configs (${configRows.length}) found for ig_account_id:`,
          igAccountId,
          '— inbound message dropped.'
        )
        continue
      }

      const config = configRows[0]

      if (event.read) {
        await handleReadReceipt(event.read.mid)
        continue
      }

      if (event.message) {
        await processMessagingEvent(
          event.message,
          event.sender.id,
          config.account_id,
          config.user_id,
          decrypt(config.access_token)
        )
      }
    }
  }
}

/**
 * Mirror a read receipt onto `messages.status`. Instagram's read
 * event only carries the id of the most recently read message (not a
 * per-message ladder like WhatsApp's status webhook), so this simply
 * flips that one row — same shape as the WhatsApp route's status
 * mirror, minus the broadcast_recipients side (Instagram has no
 * broadcasts in this integration).
 */
async function handleReadReceipt(mid: string) {
  const { error } = await supabaseAdmin().from('messages').update({ status: 'read' }).eq('message_id', mid)
  if (error) {
    console.error('[instagram webhook] error updating message read status:', error)
  }
}

async function processMessagingEvent(
  message: InstagramMessage,
  senderIgsid: string,
  accountId: string,
  configOwnerUserId: string,
  accessToken: string
) {
  // Echoes mirror OUR OWN sends (agent replies, automation/flow sends)
  // back through the webhook. Skip them — send-message.ts already
  // persisted the row when it made the call; re-ingesting here would
  // duplicate every outbound message as a second, wrongly-attributed
  // "customer" message.
  if (message.is_echo) return

  const contactName: string | null = null // Instagram gives no profile name inline; resolved lazily below only for new contacts.

  const contactOutcome = await findOrCreateContact(accountId, configOwnerUserId, senderIgsid, contactName, accessToken)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
      channel: 'instagram',
    })
  }

  const { contentText, mediaUrl, contentType } = parseMessageContent(message)
  const interactiveReplyId = message.quick_reply?.payload ?? null

  let replyToInternalId: string | null = null
  if (message.reply_to?.mid) {
    const { data: parent } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('message_id', message.reply_to.mid)
      .eq('conversation_id', conversation.id)
      .maybeSingle()
    replyToInternalId = parent?.id ?? null
  }

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  // Idempotent insert — Meta retries webhook deliveries, and each
  // retry replays the same mid. Same (conversation_id, message_id)
  // unique index (migration 037) the WhatsApp route relies on.
  const { data: insertedRows, error: msgError } = await supabaseAdmin()
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: message.mid,
        status: 'delivered',
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id')

  if (msgError) {
    console.error('[instagram webhook] error inserting message:', msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) {
    console.info('[instagram webhook] duplicate inbound message ignored (idempotent replay):', message.mid)
    return
  }

  const { error: convError } = await supabaseAdmin().rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: contentText || `[${contentType}]`,
  })
  if (convError) {
    console.error('[instagram webhook] error updating conversation:', convError)
  }

  await reopenClosedConversation(supabaseAdmin(), conversation)

  // Same fan-out the WhatsApp route uses — all four of these are
  // already channel-agnostic (accountId/contactId/conversationId, no
  // WhatsApp-specific fields), so nothing about them changes here.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: interactiveReplyId,
          reply_title: contentText ?? '',
          meta_message_id: message.mid,
        }
      : {
          kind: 'text',
          text: contentText ?? '',
          meta_message_id: message.mid,
        },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const inboundText = contentText ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
    if (interactiveReplyId) {
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
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
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
    whatsapp_message_id: message.mid,
    content_type: contentType,
    text: contentText,
    channel: 'instagram',
  })
}

/**
 * Instagram attachments arrive with a direct, already-authenticated
 * CDN URL in the webhook payload — unlike WhatsApp, there is no
 * media-id-plus-separate-fetch step (no equivalent of getMediaUrl /
 * the /api/whatsapp/media proxy is needed here). Stored as-is in
 * `messages.media_url`.
 */
const ALLOWED_CONTENT_TYPES = new Set(['text', 'image', 'document', 'audio', 'video'])

function toContentType(attachmentType: string): string {
  if (attachmentType === 'file') return 'document'
  return ALLOWED_CONTENT_TYPES.has(attachmentType) ? attachmentType : 'text'
}

function parseMessageContent(message: InstagramMessage): {
  contentText: string | null
  mediaUrl: string | null
  contentType: string
} {
  const attachment = message.attachments?.[0]
  if (attachment) {
    return {
      contentText: null,
      mediaUrl: attachment.payload?.url ?? null,
      contentType: toContentType(attachment.type),
    }
  }
  if (message.quick_reply) {
    return { contentText: message.text || message.quick_reply.payload, mediaUrl: null, contentType: 'text' }
  }
  return { contentText: message.text ?? null, mediaUrl: null, contentType: 'text' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  igsid: string,
  _name: string | null,
  accessToken: string
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingInstagramContact(supabaseAdmin(), accountId, igsid)
  if (existingContact) {
    return { contact: existingContact, wasCreated: false }
  }

  // Best-effort profile fetch — never throws, returns null on any
  // failure (outside the messaging window, revoked token, etc).
  const profile = await getIgUserProfile({ igsid, accessToken })

  const { data: newContact, error: createError } = await supabaseAdmin()
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
      const raced = await findExistingInstagramContact(supabaseAdmin(), accountId, igsid)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[instagram webhook] error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(accountId: string, configOwnerUserId: string, contactId: string) {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[instagram webhook] error finding conversation:', findError)
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
      channel: 'instagram',
    })
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
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false }
      }
    }
    console.error('[instagram webhook] error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}
