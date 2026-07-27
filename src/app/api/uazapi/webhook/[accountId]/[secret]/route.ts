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
// Payload-shape caveat: uazapi's OpenAPI spec doesn't publish a
// concrete example of an inbound `messages` webhook event, so the
// field mapping below is a best-effort reading of its documented
// `Message` schema (shared across /message/find, /chat/find, etc.)
// and its own outbound `type` vocabulary. Validate and adjust once
// live payloads are observed against a real instance.
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
  sender?: string
  fromMe?: boolean
  messageType?: string
  text?: string
  content?: unknown
  messageTimestamp?: number
  quoted?: string
  buttonOrListid?: string
  /** Present on reaction events — the target message's id. */
  reaction?: string
}

interface UazapiWebhookEvent {
  event: string
  instance?: string
  data: Record<string, unknown>
}

/**
 * Best-effort mapping of uazapi's inbound message type onto the
 * shared NormalizedContentType vocabulary — see the file-level caveat.
 */
function mapUazapiTypeToContentType(messageType: string | undefined): NormalizedContentType {
  switch (messageType) {
    case 'image':
    case 'sticker':
      return 'image'
    case 'video':
    case 'videoplay':
    case 'ptv':
      return 'video'
    case 'document':
      return 'document'
    case 'audio':
    case 'ptt':
    case 'myaudio':
      return 'audio'
    case 'location':
      return 'location'
    case 'button':
    case 'list':
    case 'buttonsResponseMessage':
    case 'listResponseMessage':
      return 'interactive'
    case 'reaction':
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
  if (event.event === 'connection') {
    // Only the coarse status is trustworthy from the webhook payload
    // alone (its exact shape isn't documented). The paired phone number
    // is filled in by the Settings QR-pairing screen's own status
    // poll (GET /api/uazapi/instance/status), which calls
    // getInstanceStatus() and reads status.jid.user directly — no
    // guessing required there.
    const data = event.data as { status?: string }
    if (data.status) {
      await supabaseAdmin()
        .from('whatsapp_config')
        .update({ uazapi_status: data.status })
        .eq('account_id', config.account_id)
        .eq('provider', 'uazapi')
    }
    return
  }

  if (event.event === 'messages_update') {
    const data = event.data as { messageid?: string; id?: string; status?: string; messageTimestamp?: number }
    const externalId = data.messageid ?? data.id
    if (!externalId || !data.status) return
    await handleStatusUpdate({
      externalId,
      status: mapUazapiStatusToNormalized(data.status),
      timestampMs: data.messageTimestamp ?? Date.now(),
    })
    return
  }

  if (event.event !== 'messages') return

  const data = event.data as UazapiWebhookMessage
  // configureWebhook already sets excludeMessages: ['wasSentByApi'],
  // but `fromMe` is a second, cheap guard against ever processing an
  // agent's own outbound send as if a customer sent it.
  if (data.fromMe) return

  const externalId = data.messageid ?? data.id
  const senderJid = data.sender ?? data.chatid
  if (!externalId || !senderJid) return

  const senderPhone = stripJidSuffix(senderJid)
  const contentType = mapUazapiTypeToContentType(data.messageType)

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
    // uazapi's webhook Message shape carries no separate "contact
    // profile name" field the way Meta's `contacts[].profile.name`
    // does — fall back to the phone number. findOrCreateContact only
    // overwrites an existing contact's name when a non-empty one is
    // supplied, so this never clobbers a name already on file.
    contactName: senderPhone,
    message: {
      externalId,
      from: senderPhone,
      timestampMs: data.messageTimestamp ?? Date.now(),
      contentType,
      text,
      mediaUrl,
      interactiveReplyId: data.buttonOrListid ?? null,
      replyToExternalId: data.quoted || null,
    },
  })
}
