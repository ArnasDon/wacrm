import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyZernioWebhookSignature } from '@/lib/instagram/zernio-webhook-signature'
import { handleInboundInstagramMessage, markMessageRead, toContentType } from '@/lib/instagram/inbound'

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

interface ZernioWebhookPayload {
  id: string
  event: string
  message?: ZernioWebhookMessage
  account?: ZernioWebhookAccount
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

  if (payload.event !== 'message.received' || !payload.message) return

  const message = payload.message
  // Echoes: an outgoing message somehow arriving on message.received
  // rather than message.sent. Defensive only — Zernio's docs describe
  // message.received as customer-originated, but skipping non-incoming
  // directions here mirrors the is_echo guard on the Meta route so an
  // agent's own send can never be re-ingested as a second "customer"
  // message.
  if (message.direction !== 'incoming') return

  const attachment = message.attachments?.[0]

  await handleInboundInstagramMessage(supabaseAdmin(), {
    accountId: config.account_id,
    configOwnerUserId: config.user_id,
    igsid: message.sender.id,
    mid: message.platformMessageId,
    contentText: attachment ? null : message.text,
    mediaUrl: attachment?.url ?? null,
    contentType: attachment ? toContentType(attachment.type) : 'text',
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
