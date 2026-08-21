import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { getIgUserProfile } from '@/lib/instagram/api'
import {
  handleInboundDmMessage,
  handleOutboundEchoMessage,
  markMessageRead,
  toContentType,
} from '@/lib/messaging/dm-inbound'

// Same reasoning as src/app/api/whatsapp/webhook/route.ts: the after()
// callback can fan out to a profile-lookup call per new contact, so
// give it headroom beyond the platform default.
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
// Instagram Messaging webhook envelope.
//
// Structurally different from WhatsApp's `entry[].changes[].value`
// shape (see the WhatsApp route) — Instagram uses
// `entry[].messaging[]`, one object per message/event, keyed by
// `sender.id` / `recipient.id` (both Instagram-Scoped IDs) rather
// than a phone_number_id + contacts array.
// ============================================================

interface InstagramAttachment {
  type: string // 'image' | 'video' | 'audio' | 'file' | ...
  payload?: { url?: string }
}

interface InstagramMessage {
  mid: string
  text?: string
  attachments?: InstagramAttachment[]
  quick_reply?: { payload: string }
  /**
   * Present when the customer swipe-replies to one of our messages.
   */
  reply_to?: { mid: string }
  /**
   * True when this event mirrors a message OUR page/app sent — via
   * wacrm's own API call, OR an agent replying from the native
   * Instagram app / Meta's own inbox. On an echo, Meta swaps the usual
   * sender/recipient roles: `sender.id` is OUR ig account and
   * `recipient.id` is the customer (see `processWebhook`, which
   * resolves the account-routing id and the customer id accordingly
   * for both cases). Routed to `handleOutboundEchoMessage` rather than
   * dropped — that function's own idempotent upsert is what safely
   * no-ops when this really was wacrm's own send being echoed back,
   * without silently losing an agent's external-app reply the rest of
   * the time.
   */
  is_echo?: boolean
}

interface InstagramMessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: InstagramMessage
  read?: { mid: string }
}

interface InstagramWebhookEntry {
  id: string
  time?: number
  messaging?: InstagramMessagingEvent[]
}

// GET - Webhook verification. Mirrors the WhatsApp route's brute-force
// match over every connected account's config — Meta's verification
// ping carries no account-identifying info beyond the shared token.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    const { data: configs, error: configError } = await supabaseAdmin()
      .from('instagram_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError)
      return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
    }

    const matched = configs.some((config: { verify_token: string | null }) => {
      if (!config.verify_token) return false
      try {
        return decrypt(config.verify_token) === verifyToken
      } catch {
        return false
      }
    })

    if (matched) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 })
  } catch (error) {
    console.error('Error in Instagram webhook GET verification:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Receive messages. Same ack-fast-then-process pattern as the
// WhatsApp route: verify signature synchronously, defer the actual
// work into after() so Meta gets its 200 within the ~20s window,
// while the runtime keeps the function alive until the callback
// resolves (required on serverless — see the WhatsApp route's comment
// on issue #301 for why a detached promise isn't safe here).
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[instagram webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: InstagramWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('Error processing Instagram webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: InstagramWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    if (!entry.messaging) continue

    for (const event of entry.messaging) {
      // For a genuine customer message, WE are the recipient. For an
      // echo (see InstagramMessage.is_echo's own doc comment), Meta
      // flips the roles: WE are the sender and the customer is the
      // recipient — so which field is "our account" to route by
      // depends on which kind of event this is.
      const isEcho = Boolean(event.message?.is_echo)
      const igAccountId = isEcho ? event.sender.id : event.recipient.id
      const customerIgsid = isEcho ? event.recipient.id : event.sender.id

      const { data: configRows, error: configError } = await supabaseAdmin()
        .from('instagram_config')
        .select('*')
        .eq('ig_account_id', igAccountId)

      if (configError) {
        console.error('Error fetching instagram_config for ig_account_id:', igAccountId, configError)
        continue
      }
      if (!configRows || configRows.length === 0) {
        console.error('No Instagram config found for ig_account_id:', igAccountId)
        continue
      }
      if (configRows.length > 1) {
        console.error(
          `Multiple Instagram configs (${configRows.length}) found for ig_account_id:`,
          igAccountId,
          '— inbound message dropped.'
        )
        continue
      }

      const config = configRows[0]

      if (event.read) {
        await markMessageRead(supabaseAdmin(), event.read.mid)
        continue
      }

      if (event.message) {
        await processMessagingEvent(
          event.message,
          customerIgsid,
          isEcho,
          config.account_id,
          config.user_id,
          decrypt(config.access_token)
        )
      }
    }
  }
}

async function processMessagingEvent(
  message: InstagramMessage,
  customerIgsid: string,
  isEcho: boolean,
  accountId: string,
  configOwnerUserId: string,
  accessToken: string
) {
  const { contentText, mediaUrl, contentType } = parseMessageContent(message)

  if (isEcho) {
    // An agent replied from the native Instagram app / Meta's own
    // inbox instead of through wacrm — record it rather than the old
    // unconditional drop; handleOutboundEchoMessage's own idempotent
    // upsert safely no-ops on the OTHER case this event also covers
    // (wacrm's own send-message.ts already persisted the row itself).
    await handleOutboundEchoMessage(supabaseAdmin(), {
      channel: 'instagram',
      accountId,
      configOwnerUserId,
      customerId: customerIgsid,
      mid: message.mid,
      contentText,
      mediaUrl,
      contentType,
      replyToMid: message.reply_to?.mid ?? null,
      resolveProfile: () => getIgUserProfile({ igsid: customerIgsid, accessToken }),
    })
    return
  }

  await handleInboundDmMessage(supabaseAdmin(), {
    channel: 'instagram',
    accountId,
    configOwnerUserId,
    senderId: customerIgsid,
    mid: message.mid,
    contentText,
    mediaUrl,
    contentType,
    interactiveReplyId: message.quick_reply?.payload ?? null,
    replyToMid: message.reply_to?.mid ?? null,
    // Instagram gives no profile name inline on the message event —
    // resolved lazily here (Graph API call, best-effort, never throws)
    // only when findOrCreateContact determines the contact is new.
    resolveProfile: () => getIgUserProfile({ igsid: customerIgsid, accessToken }),
  })
}

/**
 * Instagram attachments arrive with a direct, already-authenticated
 * CDN URL in the webhook payload — unlike WhatsApp, there is no
 * media-id-plus-separate-fetch step (no equivalent of getMediaUrl /
 * the /api/whatsapp/media proxy is needed here). Stored as-is in
 * `messages.media_url`.
 */
function parseMessageContent(message: InstagramMessage): {
  contentText: string | null
  mediaUrl: string | null
  contentType: string
} {
  const attachment = message.attachments?.[0]
  if (attachment) {
    return {
      contentText: null,
      mediaUrl: attachment.payload?.url ?? null,
      contentType: toContentType(attachment.type),
    }
  }
  if (message.quick_reply) {
    return { contentText: message.text || message.quick_reply.payload, mediaUrl: null, contentType: 'text' }
  }
  return { contentText: message.text ?? null, mediaUrl: null, contentType: 'text' }
}
