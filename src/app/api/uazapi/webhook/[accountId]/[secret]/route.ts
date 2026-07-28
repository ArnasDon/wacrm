import { NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMessageMedia } from '@/lib/whatsapp/uazapi-api'
import { resolveUazapiPlatformCredentials } from '@/lib/whatsapp/uazapi-platform-config'
import {
  processInboundMessage,
  handleStatusUpdate,
  type NormalizedContentType,
} from '@/lib/whatsapp/inbound-core'

// ============================================================
// uazapi inbound webhook.
//
// Unlike Meta, uazapi does not sign its webhook payloads (no
// X-Hub-Signature-256 equivalent — see the architecture plan's Risks
// section). The mitigation: a random secret generated at instance
// connect time (`whatsapp_config.uazapi_webhook_secret`, encrypted at
// rest) is embedded in the URL path itself and compared in constant
// time on every request. This is weaker than HMAC (it doesn't protect
// against the URL leaking via logs/proxies) but is the standard
// fallback when the provider gives us nothing to verify against.
//
// Payload shape: confirmed against a real free.uazapi.com instance
// (captured via a temporary raw-payload log during debugging — see
// commit history). uazapi's OpenAPI spec never published a concrete
// example, and the real shape differs from what earlier best-effort
// reading of its documented `Message` schema assumed in several ways:
//   - The event-type field is `EventType` (capitalized), not `event`.
//   - There is no `data` wrapper — a "messages" event's payload lives
//     directly under `message`, and a "connection" event's status
//     lives under `instance.status`.
//   - `message.sender` is a WhatsApp "lid" (linked-id) on accounts
//     using that newer identity system — NOT a phone number. The
//     actual phone-number JID is `message.chatid` (and, when present,
//     `message.sender_pn`), which is what's used for `from`/contact
//     matching below.
//   - `message.type` (uazapi's own simplified vocabulary: "text",
//     "image", "video", "audio", "document", …) is a more reliable
//     content-type signal than `message.messageType`, which carries
//     Baileys-style proto names ("Conversation", "ImageMessage", …).
// The `messages_update` (status) shape was NOT observed in the
// payload that confirmed the above — its mapping still follows the
// old best-effort assumption (nested under `message`, matching the
// now-confirmed `messages` event's container) and may need another
// round of verification against a real delivery/read receipt.
// ============================================================

export const maxDuration = 60

// Untyped on purpose (no generated Database schema is used anywhere in
// this codebase) — matches the convention in the Meta webhook route,
// which types this the same way to avoid Supabase's generic inference
// collapsing chained queries to `never`.
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
  // Lengths must match for timingSafeEqual — comparing unequal-length
  // buffers throws rather than returning false, so short-circuit here.
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function stripJidSuffix(jid: string): string {
  return jid.split('@')[0]
}

interface UazapiWebhookMessage {
  messageid?: string
  id?: string
  chatid?: string
  /** WhatsApp "lid" (linked-id) — NOT a phone number on accounts using it. */
  sender?: string
  /** Phone-number-JID form of the sender, when uazapi includes it. */
  sender_pn?: string
  fromMe?: boolean
  /** uazapi's own simplified type vocabulary ("text","image",…) — preferred. */
  type?: string
  /** Baileys-style proto type name ("Conversation","ImageMessage",…) — fallback. */
  messageType?: string
  text?: string
  content?: unknown
  messageTimestamp?: number
  quoted?: string
  buttonOrListid?: string
  /** Present on reaction events — the target message's id. */
  reaction?: string
  senderName?: string
}

interface UazapiWebhookEvent {
  EventType: string
  instance?: { name?: string; status?: string }
  message?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Best-effort mapping of uazapi's inbound message type onto the
 * shared NormalizedContentType vocabulary — see the file-level caveat.
 * Checks the confirmed `type` field first (uazapi's own vocabulary,
 * shared with its outbound `/send/media` `type` param), then falls
 * back to the unconfirmed Baileys-style `messageType` names.
 */
function mapUazapiTypeToContentType(
  type: string | undefined,
  messageType: string | undefined,
): NormalizedContentType {
  switch (type) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'document':
      return 'document'
    case 'audio':
    case 'ptt':
      return 'audio'
    case 'location':
      return 'location'
    case 'reaction':
      return 'reaction'
  }
  switch (messageType) {
    case 'ImageMessage':
    case 'StickerMessage':
      return 'image'
    case 'VideoMessage':
    case 'PtvMessage':
      return 'video'
    case 'DocumentMessage':
      return 'document'
    case 'AudioMessage':
      return 'audio'
    case 'LocationMessage':
      return 'location'
    case 'ButtonsResponseMessage':
    case 'ListResponseMessage':
      return 'interactive'
    case 'ReactionMessage':
      return 'reaction'
    default:
      return 'text'
  }
}

/** uazapi's Message.status enum → the lowercase ladder handleStatusUpdate expects. */
function mapUazapiStatusToNormalized(status: string): string {
  switch (status) {
    case 'Sent':
      return 'sent'
    case 'Delivered':
      return 'delivered'
    case 'Read':
      return 'read'
    case 'Failed':
      return 'failed'
    case 'Queued':
      return 'pending'
    default:
      return status.toLowerCase()
  }
}

const MEDIA_CONTENT_TYPES = new Set<NormalizedContentType>(['image', 'video', 'document', 'audio'])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string; secret: string }> },
) {
  const { accountId, secret } = await params

  const { data: config, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'uazapi')
    .maybeSingle()

  // Same 404 regardless of "no such account" vs "wrong secret" — never
  // reveal which one it was.
  if (error || !config || !config.uazapi_webhook_secret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let expectedSecret: string
  try {
    expectedSecret = decrypt(config.uazapi_webhook_secret)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!timingSafeEqualStrings(secret, expectedSecret)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: UazapiWebhookEvent
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Same reasoning as the Meta webhook: ack fast, do the work in
  // after() so a slow subscriber/dispatch chain can't trigger the
  // provider's own retry-on-timeout behavior and double-process.
  after(async () => {
    try {
      await processUazapiEvent(config as UazapiConfigRow, body)
    } catch (err) {
      console.error('[uazapi webhook] processing failed:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

interface UazapiConfigRow {
  account_id: string
  user_id: string
  uazapi_token: string
}

async function processUazapiEvent(config: UazapiConfigRow, event: UazapiWebhookEvent): Promise<void> {
  if (event.EventType === 'connection') {
    // Only the coarse status is trustworthy from the webhook payload
    // alone. The paired phone number is filled in by the Settings
    // QR-pairing screen's own status poll (GET
    // /api/uazapi/instance/status), which calls getInstanceStatus()
    // and reads status.jid.user directly — no guessing needed there.
    const status = event.instance?.status
    if (status) {
      await supabaseAdmin()
        .from('whatsapp_config')
        .update({ uazapi_status: status })
        .eq('account_id', config.account_id)
        .eq('provider', 'uazapi')
    }
    return
  }

  if (event.EventType === 'messages_update') {
    // Unconfirmed shape — see file-header caveat. Assumed to nest
    // under `message` the same way the now-confirmed `messages` event
    // does.
    const data = event.message as
      | { messageid?: string; id?: string; status?: string; messageTimestamp?: number }
      | undefined
    const externalId = data?.messageid ?? data?.id
    if (!externalId || !data?.status) return
    await handleStatusUpdate({
      externalId,
      status: mapUazapiStatusToNormalized(data.status),
      timestampMs: data.messageTimestamp ?? Date.now(),
    })
    return
  }

  if (event.EventType !== 'messages') return

  const data = event.message as UazapiWebhookMessage | undefined
  if (!data) return
  // configureWebhook already sets excludeMessages: ['wasSentByApi'],
  // but `fromMe` is a second, cheap guard against ever processing an
  // agent's own outbound send as if a customer sent it.
  if (data.fromMe) return

  const externalId = data.messageid ?? data.id
  // `chatid`/`sender_pn` are the phone-number-JID forms; `sender` can
  // be a WhatsApp "lid" (linked-id) instead of a phone number on
  // accounts using that identity system — confirmed against a real
  // payload, see file-header caveat.
  const senderJid = data.chatid ?? data.sender_pn ?? data.sender
  if (!externalId || !senderJid) return

  const senderPhone = stripJidSuffix(senderJid)
  const contentType = mapUazapiTypeToContentType(data.type, data.messageType)

  if (contentType === 'reaction') {
    if (!data.reaction) return
    await processInboundMessage({
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      contactName: senderPhone,
      message: {
        externalId,
        from: senderPhone,
        timestampMs: data.messageTimestamp ?? Date.now(),
        contentType: 'reaction',
        text: null,
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
        reaction: { targetExternalId: data.reaction, emoji: data.text ?? '' },
      },
    })
    return
  }

  let mediaUrl: string | null = null
  if (MEDIA_CONTENT_TYPES.has(contentType)) {
    try {
      const token = decrypt(config.uazapi_token)
      const { baseUrl } = await resolveUazapiPlatformCredentials()
      const resolved = await downloadMessageMedia({ baseUrl, token, messageId: externalId })
      mediaUrl = resolved.fileUrl
    } catch (err) {
      console.error('[uazapi webhook] media resolution failed:', err)
    }
  }

  const text = data.text ?? (typeof data.content === 'string' ? data.content : null)

  await processInboundMessage({
    accountId: config.account_id,
    configOwnerUserId: config.user_id,
    // `senderName` is the WhatsApp profile name uazapi resolves for
    // us — confirmed present on the real payload. findOrCreateContact
    // only overwrites an existing contact's name when a non-empty one
    // is supplied, so this never clobbers a name already on file.
    contactName: data.senderName || senderPhone,
    message: {
      externalId,
      from: senderPhone,
      timestampMs: data.messageTimestamp ?? Date.now(),
      contentType,
      text,
      mediaUrl,
      interactiveReplyId: data.buttonOrListid || null,
      replyToExternalId: data.quoted || null,
    },
  })
}
