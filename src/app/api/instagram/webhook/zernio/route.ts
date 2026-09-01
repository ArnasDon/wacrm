import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyZernioWebhookSignature } from '@/lib/zernio/webhook-signature'
import {
  handleInboundDmMessage,
  handleOutboundEchoMessageForZernioConversation,
  ensureZernioConversationStarted,
  markMessageRead,
  toContentType,
} from '@/lib/messaging/dm-inbound'
import { extractZernioReferral } from '@/lib/zernio/webhook-referral'

// Same reasoning as src/app/api/instagram/webhook/route.ts (the
// Meta-direct route this mirrors): after() can fan out to several DB
// round-trips per inbound message, so give it headroom.
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
// https://docs.zernio.com/webhooks/inbox. Structurally different from
// Meta's `entry[].messaging[]` shape: one event per delivery, keyed by
// `account.id` (Zernio's own connected-account id, not Meta's numeric
// IG Business Account ID) rather than a brute-force verify-token match.
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
// Meta route: resolve which account this event belongs to (needed
// before we can even know which webhook secret to verify against —
// Zernio issues one secret per webhook, and each wacrm account owns
// its own webhook), verify the signature, defer the actual work into
// after() so Zernio gets its 2xx within its 5s window.
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

  // Same reasoning as the WhatsApp Zernio route's identical check: a
  // webhook registered for Instagram still receives every other
  // platform's events on the same Zernio account (no per-platform
  // webhook scoping exists), and 404ing those tripped Zernio's
  // endpoint-health circuit breaker on traffic that was never ours to
  // begin with — suppressing genuine Instagram deliveries riding the
  // same webhook along with it.
  if (payload.account?.platform && payload.account.platform !== 'instagram') {
    return NextResponse.json({ status: 'ignored', reason: 'not an instagram event' }, { status: 200 })
  }

  const { data: config, error: configError } = await supabaseAdmin()
    .from('instagram_config')
    .select('*')
    .eq('provider', 'zernio')
    .eq('zernio_account_id', zernioAccountId)
    .maybeSingle()

  if (configError) {
    console.error('[zernio webhook] error fetching instagram_config:', configError)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  if (!config) {
    console.error('[zernio webhook] no instagram_config found for zernio_account_id:', zernioAccountId)
    return NextResponse.json({ error: 'Unknown account' }, { status: 404 })
  }

  if (!config.zernio_webhook_secret) {
    console.error('[zernio webhook] account has no webhook secret configured:', zernioAccountId)
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 })
  }

  let secret: string
  try {
    secret = decrypt(config.zernio_webhook_secret)
  } catch (err) {
    console.error('[zernio webhook] failed to decrypt webhook secret:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!verifyZernioWebhookSignature(rawBody, signature, secret)) {
    console.warn('[zernio webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  after(async () => {
    try {
      await processZernioEvent(payload, config)
    } catch (error) {
      console.error('[zernio webhook] error processing event:', error)
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

  // Fires once, the instant a Zernio conversation is created — for
  // either side's first message — carrying a real customer identifier
  // even before anything has been received from them. See the
  // WhatsApp Zernio route's identical branch for the full incident
  // this fixes: an agent messaging a brand-new contact first from the
  // native app had nothing for the Coexistence echo below to attach
  // to, so it silently never showed up in wacrm.
  if (payload.event === 'conversation.started' && payload.conversation) {
    const conv = payload.conversation
    const referral = extractZernioReferral(payload)
    if (referral) console.info('[zernio webhook] conversation.started carried a referral:', referral)
    await ensureZernioConversationStarted(supabaseAdmin(), {
      channel: 'instagram',
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

  // An agent replying from the native Instagram app or Zernio's own
  // inbox UI (instead of wacrm) arrives as its own `message.sent`
  // event, not as an "outgoing"-direction `message.received` — this
  // route only recognized the latter, so every reply sent outside
  // wacrm was silently dropped (200 OK to Zernio, never persisted).
  // Confirmed 2026-08-25 against a real conversation that had zero
  // recorded agent messages despite an active back-and-forth. No
  // `source` field exists here to separate this from wacrm's own
  // Zernio-API sends the way WhatsApp Coexistence's does — but
  // wacrm's own sends are keyed by Zernio's internal message id, not
  // `platformMessageId`, and this event type has produced no
  // duplicate-message reports where the equivalent
  // "outgoing"-direction message.received case already runs this same
  // path today.
  if (payload.event === 'message.sent' && payload.message) {
    const message = payload.message
    const attachment = message.attachments?.[0]
    await handleOutboundEchoMessageForZernioConversation(supabaseAdmin(), {
      channel: 'instagram',
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

  // An "outgoing" direction on message.received means an agent replied
  // from the native Instagram app (or Zernio's own inbox UI) instead
  // of through wacrm — not a delivery-status echo of wacrm's own send,
  // which never round-trips back through this event at all. Recording
  // it (rather than the old unconditional drop) is what makes those
  // chats show up in the CRM; see handleOutboundEchoMessageForZernioConversation's
  // own doc comment for why it can only attribute this to an existing
  // conversation, never create a brand-new contact from it.
  if (message.direction === 'outgoing') {
    await handleOutboundEchoMessageForZernioConversation(supabaseAdmin(), {
      channel: 'instagram',
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
    channel: 'instagram',
    accountId: config.account_id,
    configOwnerUserId: config.user_id,
    senderId: message.sender.id,
    mid: message.platformMessageId,
    contentText: attachment ? null : message.text,
    mediaUrl: attachment?.url ?? null,
    contentType: attachment ? toContentType(attachment.type) : 'text',
    referral,
    // Zernio's `metadata` field on message.received (quick-reply taps,
    // postback/button taps, quote-replies) isn't parsed here yet —
    // every Zernio-provider inbound message is treated as plain
    // text/media for now, same scope boundary the Meta route draws
    // around Instagram quick replies not being wired into the inbox
    // renderer (see engine-send.ts's comment on that gap).
    interactiveReplyId: null,
    replyToMid: null,
    zernioConversationId: message.conversationId,
    resolveProfile: () => Promise.resolve({ name: message.sender.name, username: message.sender.username }),
  })
}
