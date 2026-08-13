import { NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getProfilePicture } from '@/lib/whatsapp/zapi-api'
import {
  processInboundMessage,
  mirrorAgentSentMessage,
  handleStatusUpdate,
  type NormalizedContentType,
} from '@/lib/whatsapp/inbound-core'
import { classifyWhatsAppChat, isNonIndividualChat } from '@/lib/whatsapp/chat-classify'

// ============================================================
// Z-API inbound webhook.
//
// Unlike Meta, Z-API does not sign its webhook payloads — same gap
// uazapi has (see the uazapi webhook route's own comment). Mitigation
// is identical: a random secret generated when the account's Z-API
// credentials are saved (`whatsapp_config.zapi_webhook_secret`,
// encrypted at rest) is embedded in the URL path and compared in
// constant time on every request.
//
// One registered webhook URL covers every Z-API event type
// (configureWebhook in zapi-api.ts calls PUT /update-every-webhooks
// once) — events are told apart by the `type` field: ReceivedCallback,
// MessageStatusCallback, ConnectedCallback, DisconnectedCallback. This
// mirrors the uazapi route's single-URL/`event`-field design.
//
// Payload shapes below are taken directly from Z-API's own webhook
// docs (developer.z-api.io/webhooks/*), fetched during
// implementation — not guessed.
// ============================================================

export const maxDuration = 60

// Untyped on purpose (no generated Database schema is used anywhere in
// this codebase) — matches the convention in the Meta/uazapi webhook
// routes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

interface ZapiReceivedEvent {
  type: 'ReceivedCallback'
  instanceId: string
  messageId: string
  phone: string
  fromMe: boolean
  momment: number
  connectedPhone?: string
  interactiveReplyId?: never
  /**
   * Z-API's own "this chat is a group" flag, per its webhook docs.
   * Optional/defensive here — not yet confirmed against a live group
   * payload from this account (no test instance was available when
   * this filter was added). `phone` itself becomes the group's id
   * (not a real number) on a group message, which the digit-length
   * fallback in chat-classify.ts also catches independently.
   */
  isGroup?: boolean
  /** Group/community display name, when Z-API includes one — group messages only. */
  chatName?: string
  text?: { message: string }
  image?: { imageUrl: string; caption?: string }
  video?: { videoUrl: string; caption?: string }
  audio?: { audioUrl: string }
  document?: { documentUrl: string; fileName?: string }
  sticker?: { stickerUrl: string }
  location?: { latitude: number; longitude: number }
  reaction?: {
    value: string
    referencedMessage?: { messageId: string }
  }
  buttonsResponseMessage?: { buttonId: string; message?: string }
  listResponseMessage?: { selectedRowId: string; message?: string }
}

interface ZapiStatusEvent {
  type: 'MessageStatusCallback'
  ids: string[]
  status: 'SENT' | 'RECEIVED' | 'READ' | 'READ_BY_ME' | 'PLAYED'
  momment: number
}

interface ZapiConnectedEvent {
  type: 'ConnectedCallback'
  connected: boolean
  phone?: string
  momment: number
}

interface ZapiDisconnectedEvent {
  type: 'DisconnectedCallback'
  disconnected: boolean
  momment: number
}

type ZapiWebhookEvent =
  | ZapiReceivedEvent
  | ZapiStatusEvent
  | ZapiConnectedEvent
  | ZapiDisconnectedEvent
  | { type: string; [key: string]: unknown }

/**
 * Z-API's status naming doesn't match our own ladder 1:1 — "RECEIVED"
 * in this context means the recipient's device received it (i.e. the
 * WhatsApp "delivered" tick), and PLAYED (a listened-to voice note) is
 * the closest equivalent we have to "read".
 */
function mapZapiStatusToNormalized(status: string): string {
  switch (status) {
    case 'SENT':
      return 'sent'
    case 'RECEIVED':
      return 'delivered'
    case 'READ':
    case 'READ_BY_ME':
    case 'PLAYED':
      return 'read'
    default:
      return status.toLowerCase()
  }
}

function mapZapiEventToContentType(event: ZapiReceivedEvent): NormalizedContentType {
  if (event.reaction) return 'reaction'
  if (event.image || event.sticker) return 'image'
  if (event.video) return 'video'
  if (event.audio) return 'audio'
  if (event.document) return 'document'
  if (event.location) return 'location'
  if (event.buttonsResponseMessage || event.listResponseMessage) return 'interactive'
  return 'text'
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string; secret: string }> },
) {
  const { accountId, secret } = await params

  const { data: config, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'zapi')
    .maybeSingle()

  // Same 404 regardless of "no such account" vs "wrong secret" — never
  // reveal which one it was.
  if (error || !config || !config.zapi_webhook_secret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let expectedSecret: string
  try {
    expectedSecret = decrypt(config.zapi_webhook_secret)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!timingSafeEqualStrings(secret, expectedSecret)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: ZapiWebhookEvent
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Ack fast, do the work in after() — same reasoning as the Meta/
  // uazapi webhook routes (a slow subscriber/dispatch chain must not
  // trigger the provider's own retry-on-timeout behavior).
  after(async () => {
    try {
      await processZapiEvent(config as ZapiConfigRow, body)
    } catch (err) {
      console.error('[z-api webhook] processing failed:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

interface ZapiConfigRow {
  account_id: string
  user_id: string
  zapi_instance_id: string
  zapi_token: string
  zapi_client_token: string | null
}

async function processZapiEvent(config: ZapiConfigRow, event: ZapiWebhookEvent): Promise<void> {
  if (event.type === 'ConnectedCallback') {
    const data = event as ZapiConnectedEvent
    const patch: Record<string, unknown> = { zapi_status: 'connected' }
    if (data.phone) {
      patch.zapi_paired_phone = data.phone
      patch.zapi_connected_at = new Date().toISOString()
    }
    await supabaseAdmin()
      .from('whatsapp_config')
      .update(patch)
      .eq('account_id', config.account_id)
      .eq('provider', 'zapi')
    return
  }

  if (event.type === 'DisconnectedCallback') {
    await supabaseAdmin()
      .from('whatsapp_config')
      .update({ zapi_status: 'disconnected' })
      .eq('account_id', config.account_id)
      .eq('provider', 'zapi')
    return
  }

  if (event.type === 'MessageStatusCallback') {
    const data = event as ZapiStatusEvent
    const normalizedStatus = mapZapiStatusToNormalized(data.status)
    // Z-API batches ids that shared a status transition into one
    // event — unlike uazapi/Meta's one-id-per-callback shape.
    for (const externalId of data.ids ?? []) {
      await handleStatusUpdate({
        externalId,
        status: normalizedStatus,
        timestampMs: data.momment ?? Date.now(),
      })
    }
    return
  }

  if (event.type !== 'ReceivedCallback') return

  const data = event as ZapiReceivedEvent
  // update-every-webhooks is registered with notifySentByMe: false,
  // which already keeps this CRM's own API-sent messages out of this
  // webhook — so a `fromMe: true` event reaching here can only be a
  // message sent directly from the linked phone's WhatsApp app, not a
  // re-processing echo. `data.phone` still identifies the chat PARTNER
  // (the customer) regardless of direction, per Z-API's webhook docs —
  // reasoned from documentation, not yet confirmed against a live
  // fromMe:true payload the way the uazapi route's mapping was (no
  // active Z-API test instance available at implementation time). See
  // mirrorAgentSentMessage's own comment for the full rationale.
  if (!data.messageId || !data.phone) return

  // Group / community / channel messages are NOT customer contacts —
  // Z-API forwards these through the same ReceivedCallback as a real
  // 1:1 chat, and `phone` becomes the group/community's id (which
  // looks superficially like a phone number once naively parsed).
  // Classify BEFORE any DB work — and before the profile-photo
  // lookup below, so a group message doesn't waste an API call
  // either. See chat-classify.ts for the detection rules and their
  // confidence caveats (Z-API's `isGroup` flag is unconfirmed against
  // a live payload; the digit-length fallback catches it either way).
  const chatKind = classifyWhatsAppChat(data.phone, { explicitIsGroup: data.isGroup })
  if (isNonIndividualChat(chatKind)) {
    console.log(`[z-api webhook] skipping ${chatKind} chat (not a customer contact):`, {
      phone: data.phone,
      chatName: data.chatName,
    })
    return
  }

  const contentType = mapZapiEventToContentType(data)

  // Z-API's received-message payload carries no profile photo of its
  // own (unlike uazapi, whose "messages" event includes one inline) —
  // a dedicated lookup call is needed. Best-effort: a missing/failed
  // photo must never block message processing.
  let contactAvatarUrl: string | null = null
  try {
    const token = decrypt(config.zapi_token)
    const clientToken = config.zapi_client_token ? decrypt(config.zapi_client_token) : undefined
    const photo = await getProfilePicture({
      instanceId: config.zapi_instance_id,
      token,
      clientToken,
      phone: data.phone,
    })
    contactAvatarUrl = photo.url
  } catch (err) {
    console.warn('[z-api webhook] getProfilePicture failed (non-fatal):', err)
  }

  if (contentType === 'reaction') {
    // Agent reactions added from the phone aren't mirrored yet — see
    // mirrorAgentSentMessage's own comment on that gap.
    if (data.fromMe) return
    if (!data.reaction?.referencedMessage?.messageId) return
    await processInboundMessage({
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      // Z-API's received-message payload carries no separate "contact
      // profile name" field the way Meta's contacts[].profile.name
      // does — same fallback-to-phone convention as the uazapi route.
      contactName: data.phone,
      contactAvatarUrl,
      message: {
        externalId: data.messageId,
        from: data.phone,
        timestampMs: data.momment ?? Date.now(),
        contentType: 'reaction',
        text: null,
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
        reaction: {
          targetExternalId: data.reaction.referencedMessage.messageId,
          emoji: data.reaction.value ?? '',
        },
      },
    })
    return
  }

  // Z-API's own payload already carries a direct, publicly fetchable
  // media URL (imageUrl/audioUrl/videoUrl/documentUrl) — unlike
  // uazapi, there's no separate "resolve media" API call needed here.
  let mediaUrl: string | null = null
  let text: string | null = data.text?.message ?? null
  let interactiveReplyId: string | null = null

  switch (contentType) {
    case 'image':
      mediaUrl = data.image?.imageUrl ?? data.sticker?.stickerUrl ?? null
      text = data.image?.caption ?? null
      break
    case 'video':
      mediaUrl = data.video?.videoUrl ?? null
      text = data.video?.caption ?? null
      break
    case 'audio':
      mediaUrl = data.audio?.audioUrl ?? null
      break
    case 'document':
      mediaUrl = data.document?.documentUrl ?? null
      break
    case 'interactive':
      interactiveReplyId =
        data.buttonsResponseMessage?.buttonId ?? data.listResponseMessage?.selectedRowId ?? null
      text =
        data.buttonsResponseMessage?.message ?? data.listResponseMessage?.message ?? null
      break
  }

  const normalizedMessage = {
    externalId: data.messageId,
    from: data.phone,
    timestampMs: data.momment ?? Date.now(),
    contentType,
    text,
    mediaUrl,
    interactiveReplyId,
    replyToExternalId: null,
  }

  // Sent from the agent's own phone, not through this CRM's API —
  // mirror it into the thread instead of treating it as a customer
  // message. See the `fromMe` comment above for why this can't loop.
  if (data.fromMe) {
    await mirrorAgentSentMessage({
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      contactName: data.phone,
      contactAvatarUrl,
      message: normalizedMessage,
    })
    return
  }

  await processInboundMessage({
    accountId: config.account_id,
    configOwnerUserId: config.user_id,
    contactName: data.phone,
    contactAvatarUrl,
    message: normalizedMessage,
  })
}
