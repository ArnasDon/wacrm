import { after, NextResponse } from 'next/server'
import { scopedCollection, systemContext } from '@/lib/db/scoped'
import { findWebhookRouteByPhoneNumberId, verifyTokenMatchesAnyAccount } from '@/lib/db/unscoped'
import type { MessageDoc, WhatsAppConfigDoc } from '@/lib/db/types'
import { decrypt } from '@/lib/security/secrets'
import { kickBackgroundWork } from '@/lib/jobs/background'
import { handleInboundMessage } from '@/lib/sales/agent'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { getOrCreateConversation, recordInbound, upsertContactByPhone } from '@/lib/whatsapp/store'

// ============================================================
// Meta WhatsApp Cloud API webhook (MongoDB).
//
// Tenant routing: metadata.phone_number_id → the one account that owns
// that number (unique index) → systemContext for THAT account only.
//
// Authentication: HMAC-SHA256 over the raw body with the app secret of
// THAT account (each merchant connects their own Meta app), falling
// back to META_APP_SECRET on single-tenant installs. Fails closed.
// Routing has to happen before verification — the body is the only
// thing that says which secret to check against — so the payload is
// parsed first and nothing is written until the signature holds.
//
// Processing happens after the 200 is sent so Meta's delivery timeout
// is never hit by a slow AI call.
// ============================================================

interface WAMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  video?: { id: string; mime_type: string; caption?: string }
  interactive?: {
    type: string
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string }
  }
  button?: { text: string }
}

interface WebhookBody {
  entry?: Array<{ changes?: Array<{ field?: string; value?: WAChangeValue }> }>
}

interface WAChangeValue {
  metadata?: { phone_number_id?: string }
  contacts?: Array<{ profile?: { name?: string }; wa_id: string }>
  messages?: WAMessage[]
  statuses?: Array<{ id: string; status: string; errors?: Array<{ title?: string }> }>
}

/** GET — Meta's subscription handshake. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const challenge = searchParams.get('hub.challenge')
  const token = searchParams.get('hub.verify_token')
  if (mode !== 'subscribe' || !challenge || !token || token.length > 200) {
    return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 })
  }
  if (await verifyTokenMatchesAnyAccount(token, decrypt)) {
    return new Response(challenge.slice(0, 200), { status: 200, headers: { 'content-type': 'text/plain' } })
  }
  return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 })
}

/** POST — inbound messages + delivery statuses. */
export async function POST(request: Request) {
  const raw = await request.text()
  let body: WebhookBody
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const phoneNumberId = firstPhoneNumberId(body)
  const route = phoneNumberId ? await findWebhookRouteByPhoneNumberId(phoneNumberId) : null
  if (!phoneNumberId || !route) {
    // Not ours — nothing to verify against and nothing to store. 200 so
    // Meta stops retrying a payload we will never be able to use.
    console.warn('[webhook] no account for phone_number_id', phoneNumberId)
    return NextResponse.json({ status: 'ignored' })
  }

  let appSecret: string | null = null
  if (route.appSecretEnc) {
    try {
      appSecret = decrypt(route.appSecretEnc)
    } catch {
      appSecret = null // rotated ENCRYPTION_KEY — treat as unconfigured
    }
  }
  if (!verifyMetaWebhookSignature(raw, request.headers.get('x-hub-signature-256'), appSecret)) {
    await noteWebhookRejected(route.accountId, appSecret ? 'signature' : 'no-secret')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  after(() =>
    processWebhook(route.accountId, phoneNumberId, body).catch((err) =>
      console.error('[webhook] processing failed:', err),
    ),
  )
  return NextResponse.json({ status: 'received' })
}

/** The number a payload is about — Meta batches one WABA per delivery. */
function firstPhoneNumberId(body: WebhookBody): string | null {
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const id = change?.value?.metadata?.phone_number_id
      if (typeof id === 'string' && id) return id
    }
  }
  return null
}

const REJECTIONS = {
  signature: 'A delivery arrived but its signature did not match your app secret — check the App Secret in Settings.',
  'no-secret': 'A delivery arrived but no app secret is saved, so it could not be verified — add it in Settings.',
} as const

/**
 * Leave a breadcrumb the merchant can see, so "I sent a message and
 * nothing happened" has an answer in the UI. Written before the request
 * is authenticated, so it stores one of two fixed sentences and never
 * anything the caller supplied.
 */
async function noteWebhookRejected(accountId: string, reason: keyof typeof REJECTIONS) {
  try {
    const ctx = systemContext(accountId, 'whatsapp-webhook')
    const configs = await scopedCollection<WhatsAppConfigDoc>(ctx, 'whatsapp_configs')
    await configs.updateOne({}, { $set: { lastWebhookError: REJECTIONS[reason], lastWebhookErrorAt: new Date() } })
  } catch (err) {
    console.error('[webhook] could not record rejection', err)
  }
}

function toMessageFields(m: WAMessage): Pick<MessageDoc, 'type' | 'text' | 'media'> {
  switch (m.type) {
    case 'text':
      return { type: 'text', text: m.text?.body?.slice(0, 4096) ?? '', media: null }
    case 'image':
      return { type: 'image', text: m.image?.caption ?? null, media: { id: m.image?.id ?? null, mime: m.image?.mime_type ?? null, filename: null } }
    case 'document':
      return {
        type: 'document',
        text: m.document?.caption ?? null,
        media: { id: m.document?.id ?? null, mime: m.document?.mime_type ?? null, filename: m.document?.filename?.slice(0, 200) ?? null },
      }
    case 'audio':
      return { type: 'audio', text: null, media: { id: m.audio?.id ?? null, mime: m.audio?.mime_type ?? null, filename: null } }
    case 'video':
      return { type: 'video', text: m.video?.caption ?? null, media: { id: m.video?.id ?? null, mime: m.video?.mime_type ?? null, filename: null } }
    case 'interactive':
      return {
        type: 'text',
        text: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null,
        media: null,
      }
    case 'button':
      return { type: 'text', text: m.button?.text ?? null, media: null }
    default:
      return { type: 'other', text: null, media: null }
  }
}

async function processWebhook(accountId: string, phoneNumberId: string, body: WebhookBody) {
  const ctx = systemContext(accountId, 'whatsapp-webhook')
  const configs = await scopedCollection<WhatsAppConfigDoc>(ctx, 'whatsapp_configs')
  await configs.updateOne({}, { $set: { lastWebhookAt: new Date(), lastWebhookError: null, lastWebhookErrorAt: null } })
  kickBackgroundWork(accountId)

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      // The signature only vouches for the number we routed on; a
      // payload mixing in another number is not ours to act on.
      if (!value || value.metadata?.phone_number_id !== phoneNumberId) continue

      for (const status of value.statuses ?? []) {
        const map: Record<string, MessageDoc['status']> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }
        const next = map[status.status]
        if (!next || typeof status.id !== 'string') continue
        const messages = await scopedCollection<MessageDoc>(ctx, 'messages')
        await messages.updateOne(
          { waMessageId: status.id },
          { $set: { status: next, ...(next === 'failed' ? { error: status.errors?.[0]?.title?.slice(0, 300) ?? 'Delivery failed' } : {}) } },
        )
      }

      for (const m of value.messages ?? []) {
        if (typeof m.from !== 'string' || typeof m.id !== 'string') continue
        const profileName = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.slice(0, 120) ?? null
        const contact = await upsertContactByPhone(ctx, m.from, profileName)
        const conversation = await getOrCreateConversation(ctx, contact._id)
        const ts = Number(m.timestamp)
        const msg = await recordInbound(ctx, {
          conversation,
          waMessageId: m.id,
          at: Number.isFinite(ts) ? new Date(ts * 1000) : new Date(),
          ...toMessageFields(m),
        })
        if (msg) await handleInboundMessage(ctx, conversation, msg)
      }
    }
  }
}
