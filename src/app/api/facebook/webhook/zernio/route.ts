import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyZernioWebhookSignature } from '@/lib/zernio/webhook-signature'
import { extractZernioReferral } from '@/lib/zernio/webhook-referral'
import {
  handleInboundDmMessage,
  handleOutboundEchoMessageForZernioConversation,
  ensureZernioConversationStarted,
  markMessageRead,
  toContentType,
} from '@/lib/messaging/dm-inbound'

// Same reasoning as src/app/api/instagram/webhook/zernio/route.ts,
// which this mirrors exactly apart from the config table: Facebook
// has no direct-Meta path in wacrm, so this is the only Facebook
// webhook route.
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
// Zernio inbox webhook envelope — see
// https://docs.zernio.com/webhooks/inbox. Identical shape to the
// Instagram Zernio route; only the platform value and config table differ.
// ============================================================

interface ZernioWebhookAttachment {
  type: string // 'image' | 'video' | 'file' | 'sticker' | 'audio'
  url: string
}

interface ZernioWebhookSender {
  id: string
  name?: string
  username?: string
}

interface ZernioWebhookMessage {
  id: string
  conversationId: string
  platform: string
  platformMessageId: string
  direction: 'incoming' | 'outgoing'
  text: string | null
  attachments: ZernioWebhookAttachment[]
  sender: ZernioWebhookSender
}

interface ZernioWebhookAccount {
  id: string
  accountId?: string
  platform: string
}

/** See the WhatsApp Zernio route's identical interface for what this
 *  event is and why it's handled — same shape, platform-neutral. */
interface ZernioWebhookConversation {
  id: string
  platform: string
  platformConversationId: string
  participantId: string
  participantName?: string
  participantUsername?: string
  status: string
}

interface ZernioWebhookPayload {
  id: string
  event: string
  message?: ZernioWebhookMessage
  account?: ZernioWebhookAccount
  conversation?: ZernioWebhookConversation
}

// POST - Receive events. Same ack-fast-then-process pattern as the
// Instagram Zernio route.
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-zernio-signature')

  let payload: ZernioWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const zernioAccountId = payload.account?.accountId ?? payload.account?.id
  if (!zernioAccountId) {
    return NextResponse.json({ error: 'Missing account in payload' }, { status: 400 })
  }

  // Same reasoning as the WhatsApp/Instagram Zernio routes' identical
  // check: a webhook registered for Facebook still receives every
  // other platform's events on the same Zernio account (no
  // per-platform webhook scoping exists), and 404ing those tripped
  // Zernio's endpoint-health circuit breaker on traffic that was never
  // ours to begin with.
  if (payload.account?.platform && payload.account.platform !== 'facebook') {
    return NextResponse.json({ status: 'ignored', reason: 'not a facebook event' }, { status: 200 })
  }

  const { data: config, error: configError } = await supabaseAdmin()
    .from('facebook_config')
    .select('*')
    .eq('zernio_account_id', zernioAccountId)
    .maybeSingle()

  if (configError) {
    console.error('[facebook zernio webhook] error fetching facebook_config:', configError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  if (!config) {
    console.error('[facebook zernio webhook] no facebook_config found for zernio_account_id:', zernioAccountId)
    return NextResponse.json({ error: 'Unknown account' }, { status: 404 })
  }

  if (!config.zernio_webhook_secret) {
    console.error('[facebook zernio webhook] account has no webhook secret configured:', zernioAccountId)
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 })
  }

  let secret: string
  try {
    secret = decrypt(config.zernio_webhook_secret)
  } catch (err) {
    console.error('[facebook zernio webhook] failed to decrypt webhook secret:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!verifyZernioWebhookSignature(rawBody, signature, secret)) {
    console.warn('[facebook zernio webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  after(async () => {
    try {
      await processZernioEvent(payload, config)
    } catch (error) {
      console.error('[facebook zernio webhook] error processing event:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processZernioEvent(
  payload: ZernioWebhookPayload,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
) {
  if (payload.event === 'message.read' && payload.message) {
    await markMessageRead(supabaseAdmin(), payload.message.platformMessageId)
    return
  }

  // Same fix as the WhatsApp/Instagram Zernio routes (identical gap,
  // confirmed 2026-08-25): fires once, the instant a Zernio
  // conversation is created, carrying a real customer identifier even
  // before anything has been received from them — without this, an
  // agent messaging a brand-new contact first from the native app has
  // nothing for the Coexistence echo below to attach to.
  if (payload.event === 'conversation.started' && payload.conversation) {
    const conv = payload.conversation
    const referral = extractZernioReferral(payload)
    if (referral) console.info('[zernio webhook] conversation.started carried a referral:', referral)
    await ensureZernioConversationStarted(supabaseAdmin(), {
      channel: 'facebook',
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      participantId: conv.participantId,
      zernioConversationId: conv.id,
      referral,
      resolveProfile: () =>
        Promise.resolve({ name: conv.participantName, username: conv.participantUsername }),
    })
    return
  }

  // Same fix as the Instagram Zernio route (identical bug, confirmed
  // 2026-08-25): an agent reply from outside wacrm arrives as its own
  // `message.sent` event, which this route previously never
  // recognized (only `message.received`) — silently dropping it.
  if (payload.event === 'message.sent' && payload.message) {
    const message = payload.message
    const attachment = message.attachments?.[0]
    await handleOutboundEchoMessageForZernioConversation(supabaseAdmin(), {
      channel: 'facebook',
      accountId: config.account_id,
      zernioConversationId: message.conversationId,
      mid: message.platformMessageId,
      contentText: attachment ? null : message.text,
      mediaUrl: attachment?.url ?? null,
      contentType: attachment ? toContentType(attachment.type) : 'text',
      replyToMid: null,
    })
    return
  }

  if (payload.event !== 'message.received' || !payload.message) return

  const message = payload.message
  const attachment = message.attachments?.[0]

  // Same reasoning as the Instagram Zernio route: "outgoing" here means
  // an agent replied from the native Messenger app instead of through
  // wacrm, not a delivery-status echo of wacrm's own send.
  if (message.direction === 'outgoing') {
    await handleOutboundEchoMessageForZernioConversation(supabaseAdmin(), {
      channel: 'facebook',
      accountId: config.account_id,
      zernioConversationId: message.conversationId,
      mid: message.platformMessageId,
      contentText: attachment ? null : message.text,
      mediaUrl: attachment?.url ?? null,
      contentType: attachment ? toContentType(attachment.type) : 'text',
      replyToMid: null,
    })
    return
  }
  if (message.direction !== 'incoming') return

  const referral = extractZernioReferral(payload)
  if (referral) console.info('[zernio webhook] message.received carried a referral:', referral)

  await handleInboundDmMessage(supabaseAdmin(), {
    channel: 'facebook',
    accountId: config.account_id,
    configOwnerUserId: config.user_id,
    senderId: message.sender.id,
    mid: message.platformMessageId,
    contentText: attachment ? null : message.text,
    mediaUrl: attachment?.url ?? null,
    contentType: attachment ? toContentType(attachment.type) : 'text',
    referral,
    // Same scope boundary as the Instagram Zernio route: quick-reply
    // taps / postbacks / quote-replies (Zernio's `metadata` field)
    // aren't parsed yet — every inbound message is text/media for now.
    interactiveReplyId: null,
    replyToMid: null,
    zernioConversationId: message.conversationId,
    resolveProfile: () => Promise.resolve({ name: message.sender.name, username: message.sender.username }),
  })
}
