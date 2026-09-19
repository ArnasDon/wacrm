import { after, NextResponse } from 'next/server'
import { scopedCollection, systemContext } from '@/lib/db/scoped'
import { findAccountIdByPhoneNumberId, verifyTokenMatchesAnyAccount } from '@/lib/db/unscoped'
import type { MessageDoc } from '@/lib/db/types'
import { decrypt } from '@/lib/security/secrets'
import { kickBackgroundWork } from '@/lib/jobs/background'
import { handleInboundMessage } from '@/lib/sales/agent'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { getOrCreateConversation, recordInbound, upsertContactByPhone } from '@/lib/whatsapp/store'

// ============================================================
// Meta WhatsApp Cloud API webhook (MongoDB).
//
// Authentication: HMAC-SHA256 over the raw body with META_APP_SECRET
// (fails closed). Tenant routing: metadata.phone_number_id → the one
// account that owns that number (unique index) → systemContext for
// THAT account only. Processing happens after the 200 is sent so
// Meta's delivery timeout is never hit by a slow AI call.
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
  if (!verifyMetaWebhookSignature(raw, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let body: { entry?: Array<{ changes?: Array<{ field?: string; value?: WAChangeValue }> }> }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  after(() => processWebhook(body).catch((err) => console.error('[webhook] processing failed:', err)))
  return NextResponse.json({ status: 'received' })
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

async function processWebhook(body: { entry?: Array<{ changes?: Array<{ field?: string; value?: WAChangeValue }> }> }) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!value || !phoneNumberId) continue
      const accountId = await findAccountIdByPhoneNumberId(phoneNumberId)
      if (!accountId) {
        console.warn('[webhook] no account for phone_number_id', phoneNumberId)
        continue
      }
      const ctx = systemContext(accountId, 'whatsapp-webhook')
      kickBackgroundWork(accountId)

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
