import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { enterFunnelIfNew } from '@/lib/journey/enter-funnel'

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
  /**
   * The conversation partner's display name, taken from `chat.name`
   * only. Unlike `senderName` (which falls back to `message.senderName`),
   * this is safe to trust on a `fromMe` echo: `chat` always describes the
   * OTHER party, whereas `message.senderName` there is the account owner.
   * Null when the payload carries no chat name.
   */
  chatName: string | null
  isGroup: boolean
  fromMe: boolean
  type: string
  text: string | null
  timestampMs: number
  /**
   * Set when this payload IS a reaction rather than a message — holds the
   * `message_id` of the message being reacted to. Per Uazapi's schema, a
   * reaction event carries the target's id in `message.reaction` and the
   * emoji itself in `message.text` (empty string = reaction removed).
   */
  reactionTargetId: string | null
}

const TEXT_LIKE_TYPES = new Set(['text', 'chat', 'conversation', 'extendedtextmessage'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeInbound(body: any): NormalizedInbound | null {
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
  const fromMe = Boolean(msg.fromMe)

  // On a `fromMe` echo, `sender`/`sender_pn` identify the WhatsApp account
  // owner (the one who sent it), not the conversation partner — the other
  // party is only available via `chatid`/`chat.phone`. Using sender fields
  // there would file every app-sent message under "chat with yourself".
  const conversationPhoneRaw: string = fromMe
    ? chatid.split('@')[0] || chat.phone || ''
    : msg.sender_pn || msg.sender || chatid.split('@')[0] || ''
  let fromPhone = normalizePhone(conversationPhoneRaw)
  if (!fromPhone) fromPhone = normalizePhone(chat.phone || '')

  // TEMP DIAGNOSTIC — remove once the LID-vs-phone field mapping above
  // is confirmed against a few real deliveries. Only fires when there's
  // no dedicated phone field to fall back on, so the happy path stays
  // silent.
  if (!fromMe && !msg.sender_pn) {
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
    // `id` is the full `owner:messageid` composite — same field the send
    // path (uazapi.ts) prefers when persisting `messages.message_id`. This
    // MUST match that priority order, or the fromMe-echo dedupe below never
    // finds the row the CRM already inserted and double-inserts every
    // outbound message.
    externalId: msg.id || msg.messageid || '',
    fromPhone,
    senderName: chat.name || msg.senderName || fromPhone,
    chatName: chat.name || null,
    isGroup,
    fromMe,
    type,
    text,
    timestampMs,
    reactionTargetId: msg.reaction || null,
  }
}

const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive',
])

export function mapContentType(uazapiType: string): string {
  if (ALLOWED_CONTENT_TYPES.has(uazapiType)) return uazapiType
  if (uazapiType === 'sticker') return 'image'
  if (uazapiType === 'ptt' || uazapiType === 'myaudio') return 'audio'
  return 'text'
}

/**
 * Persist an inbound reaction. Reactions are not new messages — they're
 * per-(target, actor) state — so we upsert/delete on `message_reactions`
 * and never write a row into `messages`. Mirrors `handleReaction` in the
 * Meta webhook (src/app/api/whatsapp/webhook/route.ts).
 */
async function handleReaction(
  db: ReturnType<typeof supabaseAdmin>,
  inbound: NormalizedInbound,
  conversationId: string,
  contactId: string,
  configOwnerUserId: string
) {
  if (!inbound.reactionTargetId) return

  const { data: targetMsg } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', inbound.reactionTargetId)
    .maybeSingle()

  if (!targetMsg) {
    console.warn(
      '[uazapi-webhook] reaction target message not found; skipping',
      inbound.reactionTargetId
    )
    return
  }

  // `fromMe` reactions come from the connected number's own phone (outside
  // the CRM) — there's no logged-in agent to attribute them to, so they're
  // filed under the account owner. Customer reactions are filed under the
  // contact, matching the Meta webhook's convention.
  const actorType = inbound.fromMe ? 'agent' : 'customer'
  const actorId = inbound.fromMe ? configOwnerUserId : contactId

  // Empty emoji = removal (WhatsApp sends the reaction event again with no
  // text when the reaction is cleared).
  if (!inbound.text) {
    const { error: delError } = await db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetMsg.id)
      .eq('actor_type', actorType)
      .eq('actor_id', actorId)
    if (delError) {
      console.error('[uazapi-webhook] reaction delete failed:', delError.message)
    }
    return
  }

  const { error: upsertError } = await db.from('message_reactions').upsert(
    {
      message_id: targetMsg.id,
      conversation_id: conversationId,
      actor_type: actorType,
      actor_id: actorId,
      emoji: inbound.text,
    },
    { onConflict: 'message_id,actor_type,actor_id' }
  )
  if (upsertError) {
    console.error('[uazapi-webhook] reaction upsert failed:', upsertError.message)
  }
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

  // Groups aren't customer conversations; `fromMe` (messages sent from the
  // WhatsApp app itself, outside the CRM) is handled separately below so
  // the history stays complete regardless of which surface sent it.
  if (inbound.isGroup) return

  const db = supabaseAdmin()

  const existingContact = await findExistingContact(db, accountId, inbound.fromPhone)
  let contactId: string
  let wasCreated = false

  // The name to file this contact under. On a customer reply we trust
  // `senderName` (their WhatsApp profile name). On a `fromMe` echo the
  // only trustworthy name is `chatName` (the conversation partner from
  // `chat.name`) — `senderName` there can be the account owner's own
  // name, which must never become the contact's name.
  const incomingName = inbound.fromMe ? inbound.chatName : inbound.senderName

  if (existingContact) {
    contactId = existingContact.id
    if (incomingName && incomingName !== existingContact.name) {
      // On a `fromMe` echo only fill in a name when the contact is still
      // on its phone-number placeholder — never clobber a name a customer
      // reply or a manual edit already set. Customer replies (which carry
      // the authoritative profile name) always win.
      const isPlaceholder = !existingContact.name || existingContact.name === existingContact.phone
      if (!inbound.fromMe || isPlaceholder) {
        await db
          .from('contacts')
          .update({ name: incomingName, updated_at: new Date().toISOString() })
          .eq('id', contactId)
      }
    }
  } else {
    const { data: newContact, error: createError } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        phone: inbound.fromPhone,
        name: incomingName || inbound.fromPhone,
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

  if (inbound.reactionTargetId) {
    await handleReaction(db, inbound, conversation.id, contactId, configOwnerUserId)
    return
  }

  // Messages sent from the WhatsApp app itself (outside the CRM) echo back
  // here with fromMe=true. Record them so the CRM's history stays complete,
  // but skip everything that only makes sense for a customer reply
  // (unread bump, flows/automations, funnel entry). Messages sent *through*
  // the CRM already got inserted by sendMessageToConversation — dedupe on
  // `message_id`, which uazapi echoes back as the same id it returned from
  // the send call (there's no unique constraint on it, so this is a
  // check-then-insert rather than an upsert; the CRM's own insert happens
  // synchronously before this webhook can fire, so the race window here is
  // effectively closed in practice).
  if (inbound.fromMe) {
    if (inbound.externalId) {
      const { data: existingMsg } = await db
        .from('messages')
        .select('id')
        .eq('conversation_id', conversation.id)
        .eq('message_id', inbound.externalId)
        .maybeSingle()
      if (existingMsg) return
    }

    const contentType = mapContentType(inbound.type)
    const isMediaKind = ['image', 'video', 'document', 'audio'].includes(contentType)
    const mediaUrl = isMediaKind && inbound.externalId
      ? `/api/uazapi/media/${encodeURIComponent(inbound.externalId)}`
      : null

    const { error: msgError } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'agent',
      content_type: contentType,
      content_text: inbound.text,
      media_url: mediaUrl,
      message_id: inbound.externalId || null,
      status: 'sent',
      created_at: new Date(inbound.timestampMs).toISOString(),
      provider: 'uazapi',
    })
    if (msgError) {
      console.error('[uazapi-webhook] error inserting fromMe message:', msgError)
      return
    }

    await db
      .from('conversations')
      .update({
        last_message_text: inbound.text || `[${contentType}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)

    return
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

  // Sales-funnel Kanban entry point — see the Meta webhook's identical
  // hook for the full rationale. Idempotent; failures are logged inside
  // and never throw.
  if (isFirstInboundMessage) {
    await enterFunnelIfNew(db, accountId, contactId)
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactId,
    whatsapp_message_id: inbound.externalId,
    content_type: contentType,
    text: inbound.text,
  })
}
