import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

// Mirrors the Meta webhook route's maxDuration — inbound processing can
// fan out to a media download + automations/flows dispatch.
export const maxDuration = 60

/**
 * Single global endpoint — every Uazapi instance across every account
 * points here (see /api/uazapi/instance → configureWebhook). There's
 * no per-instance path or query-string secret; instead, Uazapi echoes
 * the instance's own `token` back in every webhook payload, and that
 * token is the credential — matched here against the encrypted
 * `uazapi_instance_token` on file. This mirrors the working pattern
 * from the reference implementation (modelo-agente-de-ia's
 * `/webhook/uazapi`), which resolves the instance the same way.
 *
 * Uazapi accounts are few relative to Meta ones at this stage, so a
 * linear decrypt-and-compare over `provider='uazapi'` rows is cheap;
 * revisit (e.g. a keyed lookup column) if that stops being true.
 */
async function resolveConfigByToken(payloadToken: string | undefined, instanceName: string | undefined) {
  const db = supabaseAdmin()
  const { data: configs } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'uazapi')
    .not('uazapi_instance_token', 'is', null)

  if (!configs || configs.length === 0) return null

  if (payloadToken) {
    for (const config of configs) {
      try {
        if (decrypt(config.uazapi_instance_token) === payloadToken) return config
      } catch {
        // Malformed/undecryptable row — skip it and keep checking others.
      }
    }
  }

  // Fallback — payload's instanceName label, in case the token round-trip
  // ever fails (Uazapi always includes it too, per the documented shape).
  if (instanceName) {
    const byName = configs.find((c) => c.uazapi_instance_name === instanceName)
    if (byName) return byName
  }

  return null
}

/**
 * Uazapi's real webhook payload (confirmed against a working reference
 * implementation) is flat: `{ instanceName, token, chat: {...}, message: {...} }`.
 * `message.type` is often the generic `"media"` with the real kind in
 * `message.mediaType` (ptt/audio/image/...); text-like values
 * (text/chat/conversation/extendedTextMessage) mean plain text.
 */
interface NormalizedInbound {
  externalId: string
  fromPhone: string
  senderName: string
  isGroup: boolean
  fromMe: boolean
  type: string
  text: string | null
  timestampMs: number
}

const TEXT_LIKE_TYPES = new Set(['text', 'chat', 'conversation', 'extendedtextmessage'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeInbound(body: any): NormalizedInbound | null {
  const msg = body?.message
  if (!msg) return null
  const chat = body?.chat ?? {}

  // WhatsApp has been migrating chats to `@lid` (a privacy-preserving
  // "linked ID") instead of the phone-number-based `@s.whatsapp.net`
  // JID. When that happens, `chatid`/`sender` carry the LID (a numeric
  // string that looks like a phone number but isn't one — see issue
  // where a reply created a duplicate contact whose "phone" was a LID
  // and every outbound send to it then failed with "not on WhatsApp").
  // `sender_pn` is Uazapi's dedicated phone-number field and must be
  // preferred whenever present; `chatid`/`sender` are LID-safe
  // fallbacks only for group-detection and for the (rare) delivery
  // that has no `sender_pn` at all.
  const chatid: string = msg.chatid || msg.sender || ''
  const senderPhoneRaw: string = msg.sender_pn || msg.sender || chatid.split('@')[0] || ''
  let fromPhone = normalizePhone(senderPhoneRaw)
  if (!fromPhone) fromPhone = normalizePhone(chat.phone || '')

  // TEMP DIAGNOSTIC — remove once the LID-vs-phone field mapping above
  // is confirmed against a few real deliveries. Only fires when there's
  // no dedicated phone field to fall back on, so the happy path stays
  // silent.
  if (!msg.sender_pn) {
    console.warn('[uazapi-webhook] no sender_pn on inbound message — raw fields:', {
      chatid: msg.chatid,
      sender: msg.sender,
      sender_pn: msg.sender_pn,
      chat_phone: chat.phone,
      resolved_fromPhone: fromPhone,
    })
  }
  if (!fromPhone) return null

  const isGroup = Boolean(msg.isGroup ?? chat.wa_isGroup ?? chatid.includes('@g.us'))
  const fromMe = Boolean(msg.fromMe)

  const rawType: string = (msg.type || '').toLowerCase()
  const mediaType: string = (msg.mediaType || '').toLowerCase()
  const type = TEXT_LIKE_TYPES.has(rawType) ? 'text' : mediaType || rawType || 'text'

  const text: string | null = msg.text ?? msg.body ?? msg.content ?? msg.caption ?? null
  const timestampRaw = msg.timestamp ?? msg.messageTimestamp
  const timestampMs =
    typeof timestampRaw === 'number'
      ? (timestampRaw > 1e12 ? timestampRaw : timestampRaw * 1000)
      : Date.now()

  return {
    externalId: msg.messageid || msg.id || '',
    fromPhone,
    senderName: chat.name || msg.senderName || fromPhone,
    isGroup,
    fromMe,
    type,
    text,
    timestampMs,
  }
}

const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive',
])

function mapContentType(uazapiType: string): string {
  if (ALLOWED_CONTENT_TYPES.has(uazapiType)) return uazapiType
  if (uazapiType === 'sticker') return 'image'
  if (uazapiType === 'ptt' || uazapiType === 'myaudio') return 'audio'
  return 'text'
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = body as { token?: string; instanceName?: string } | null
  const config = await resolveConfigByToken(payload?.token, payload?.instanceName)
  if (!config) {
    console.warn('[uazapi-webhook] no matching instance for token/instanceName', {
      instanceName: payload?.instanceName,
    })
    // 200, not 401 — an unrecognized token is most likely a stale/rotated
    // instance rather than an attack, and Uazapi has no retry-on-4xx
    // guarantee we want to rely on; swallow it quietly like the message-
    // type skip branches below.
    return NextResponse.json({ status: 'unrecognized_instance' }, { status: 200 })
  }

  // Ack immediately; process after the response is sent (same rationale
  // as the Meta webhook — see src/app/api/whatsapp/webhook/route.ts).
  after(async () => {
    try {
      await processInbound(config.account_id, config.user_id, body)
    } catch (error) {
      console.error('[uazapi-webhook] error processing inbound:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processInbound(accountId: string, configOwnerUserId: string, body: unknown) {
  const inbound = normalizeInbound(body)
  if (!inbound) return

  // Groups and our own outbound echoes are not customer messages.
  if (inbound.isGroup || inbound.fromMe) return

  const db = supabaseAdmin()

  const existingContact = await findExistingContact(db, accountId, inbound.fromPhone)
  let contactId: string
  let wasCreated = false

  if (existingContact) {
    contactId = existingContact.id
    if (inbound.senderName && inbound.senderName !== existingContact.name) {
      await db
        .from('contacts')
        .update({ name: inbound.senderName, updated_at: new Date().toISOString() })
        .eq('id', contactId)
    }
  } else {
    const { data: newContact, error: createError } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        phone: inbound.fromPhone,
        name: inbound.senderName || inbound.fromPhone,
      })
      .select()
      .single()

    if (createError) {
      if (isUniqueViolation(createError)) {
        const raced = await findExistingContact(db, accountId, inbound.fromPhone)
        if (!raced) return
        contactId = raced.id
      } else {
        console.error('[uazapi-webhook] error creating contact:', createError)
        return
      }
    } else {
      contactId = newContact.id
      wasCreated = true
    }
  }

  // One conversation per (account, contact) regardless of provider —
  // matches the Meta webhook's lookup. `provider` is stamped only at
  // creation time; an existing conversation keeps whichever provider
  // opened it.
  const { data: existingConv } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  let conversation = existingConv
  let conversationCreated = false
  if (!conversation) {
    const { data: newConv, error: convError } = await db
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        contact_id: contactId,
        provider: 'uazapi',
      })
      .select()
      .single()
    if (convError || !newConv) {
      console.error('[uazapi-webhook] error creating conversation:', convError)
      return
    }
    conversation = newConv
    conversationCreated = true
  }

  if (conversationCreated) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactId,
    })
  }

  const contentType = mapContentType(inbound.type)
  const isMediaKind = ['image', 'video', 'document', 'audio'].includes(contentType)
  const mediaUrl = isMediaKind && inbound.externalId
    ? `/api/uazapi/media/${encodeURIComponent(inbound.externalId)}`
    : null

  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: inbound.text,
    media_url: mediaUrl,
    message_id: inbound.externalId || null,
    status: 'delivered',
    created_at: new Date(inbound.timestampMs).toISOString(),
    provider: 'uazapi',
  })

  if (msgError) {
    console.error('[uazapi-webhook] error inserting message:', msgError)
    return
  }

  await db
    .from('conversations')
    .update({
      last_message_text: inbound.text || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId,
    conversationId: conversation.id,
    message: {
      kind: 'text',
      text: inbound.text ?? '',
      meta_message_id: inbound.externalId,
    },
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
  if (wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId,
      context: {
        message_text: inbound.text ?? '',
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[uazapi-webhook] automations dispatch failed:', err))
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactId,
    whatsapp_message_id: inbound.externalId,
    content_type: contentType,
    text: inbound.text,
  })
}
