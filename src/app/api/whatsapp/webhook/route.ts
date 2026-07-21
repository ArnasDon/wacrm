import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { AsyncEventTrace } from '@/lib/observability/async-events'
import {
  createAsyncEventTrace,
  durationMs,
  errorFields,
  extendAsyncEventTrace,
  logAsyncEvent,
  logAsyncMetric,
} from '@/lib/observability/async-events'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAgent } from '@/lib/ai/agent-dispatch'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

export const maxDuration = 60

const WHATSAPP_WEBHOOK_ROUTE = '/api/whatsapp/webhook'
const ZAPI_REPLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const ZAPI_REPLAY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

let lastReplayCleanupAt = 0

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

interface ZapiWebhookBody {
  instanceId?: string
  type?: string
  messageId?: string
  ids?: string[]
  status?: string
  phone?: string
  phoneDevice?: string
  fromMe?: boolean
  isGroup?: boolean
  isNewsletter?: boolean
  momment?: number | string
  chatName?: string
  senderName?: string
  text?: unknown
  image?: unknown
  video?: unknown
  audio?: unknown
  document?: unknown
  reaction?: unknown
  buttonsResponseMessage?: unknown
  listResponseMessage?: unknown
  [key: string]: unknown
}

interface WhatsAppConfigRow {
  id: string
  account_id: string
  user_id: string
  zapi_instance_id: string
  zapi_webhook_secret: string | null
}

interface MessageRowRef {
  id: string
  conversation_id: string
  created_at: string
}

type PersistInboundMessageResult =
  | { status: 'stored'; row: MessageRowRef }
  | { status: 'duplicate'; existingId: string | null }
  | { status: 'error' }

type ReplayGuardResult =
  | { status: 'accepted'; id: string; dedupeKey: string }
  | { status: 'duplicate'; dedupeKey: string }
  | { status: 'error' }

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function callbackType(body: ZapiWebhookBody): string {
  return typeof body.type === 'string' && body.type.trim()
    ? body.type.trim()
    : 'MessageReceivedCallback'
}

function extractMessageId(body: ZapiWebhookBody): string | null {
  if (typeof body.messageId === 'string' && body.messageId.trim()) {
    return body.messageId.trim()
  }
  const reaction = asRecord(body.reaction)
  const reactionMessageId = stringFrom(
    reaction?.messageId ?? reaction?.msgId ?? reaction?.id
  )
  if (reactionMessageId) return reactionMessageId
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : []
  return ids[0]?.trim() ?? null
}

function parseMomentMs(value: unknown): number | null {
  if (typeof value === 'string' && value.trim()) return parseMomentMs(Number(value))
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value > 100_000_000_000) return value
  if (value > 1_000_000_000) return value * 1000
  return null
}

function buildReplayKey(body: ZapiWebhookBody, rawBody: string): string {
  const instanceId = body.instanceId || 'unknown-instance'
  const type = callbackType(body)
  const status = typeof body.status === 'string' ? body.status : ''
  const messageIds = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && !!id.trim()).join(',')
    : extractMessageId(body) ?? ''

  if (messageIds || status || body.momment) {
    return `${instanceId}:${type}:${status}:${messageIds}:${body.momment ?? ''}`
  }
  return `${instanceId}:${type}:raw:${sha256Hex(rawBody)}`
}

async function acquireReplayGuard(
  body: ZapiWebhookBody,
  rawBody: string,
  requestId: string | null,
  trace?: AsyncEventTrace
): Promise<ReplayGuardResult> {
  const dedupeKey = buildReplayKey(body, rawBody)
  const payloadTimestampMs = parseMomentMs(body.momment)
  const expiresAt = new Date(Date.now() + ZAPI_REPLAY_TTL_MS).toISOString()

  const { data, error } = await supabaseAdmin()
    .from('whatsapp_webhook_replays')
    .insert({
      session_name: body.instanceId,
      event: callbackType(body),
      dedupe_key: dedupeKey,
      status: 'processing',
      request_id: requestId,
      hmac_algorithm: 'url-secret',
      signature_timestamp_ms: null,
      payload_timestamp_ms: payloadTimestampMs,
      body_sha256: sha256Hex(rawBody),
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (!error && data?.id) {
    return { status: 'accepted', id: data.id as string, dedupeKey }
  }

  if (isUniqueViolation(error)) {
    return { status: 'duplicate', dedupeKey }
  }

  if (trace) {
    logAsyncEvent('error', 'webhook.replay_guard.failed', trace, {
      instance_id: body.instanceId,
      zapi_event: callbackType(body),
      dedupeKey,
      reason: 'insert_failed',
      ...errorFields(error),
    })
  } else {
    console.error('[webhook] Replay guard insert failed:', {
      instanceId: body.instanceId,
      event: callbackType(body),
      dedupeKey,
      error,
    })
  }
  return { status: 'error' }
}

async function markReplayGuardProcessed(id: string, trace: AsyncEventTrace) {
  const { error } = await supabaseAdmin()
    .from('whatsapp_webhook_replays')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    logAsyncEvent('error', 'webhook.replay_guard.failed', trace, {
      replay_guard_id: id,
      reason: 'mark_processed_failed',
      ...errorFields(error),
    })
  }
}

async function releaseReplayGuard(id: string, trace: AsyncEventTrace) {
  const { error } = await supabaseAdmin()
    .from('whatsapp_webhook_replays')
    .delete()
    .eq('id', id)

  if (error) {
    logAsyncEvent('error', 'webhook.replay_guard.failed', trace, {
      replay_guard_id: id,
      reason: 'release_failed',
      ...errorFields(error),
    })
  }
}

async function maybeCleanupExpiredReplayGuards() {
  const now = Date.now()
  if (now - lastReplayCleanupAt < ZAPI_REPLAY_CLEANUP_INTERVAL_MS) {
    return
  }
  lastReplayCleanupAt = now

  const { error } = await supabaseAdmin()
    .from('whatsapp_webhook_replays')
    .delete()
    .lt('expires_at', new Date(now).toISOString())

  if (error) {
    const trace = createAsyncEventTrace({ route: WHATSAPP_WEBHOOK_ROUTE })
    logAsyncEvent('error', 'webhook.replay_guard.cleanup_failed', trace, {
      ...errorFields(error),
    })
  }
}

async function loadConfig(instanceId: string): Promise<WhatsAppConfigRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, user_id, zapi_instance_id, zapi_webhook_secret')
    .eq('zapi_instance_id', instanceId)
    .maybeSingle()

  if (error) {
    throw new Error(`config lookup failed: ${error.message}`)
  }
  return (data as WhatsAppConfigRow | null) ?? null
}

export async function POST(request: Request) {
  const acknowledgedAt = Date.now()
  const requestTrace = createAsyncEventTrace({ route: WHATSAPP_WEBHOOK_ROUTE })
  const requestId = request.headers.get('x-request-id')
  const secret = new URL(request.url).searchParams.get('secret') ?? ''
  const rawBody = await request.text()

  let body: ZapiWebhookBody
  try {
    body = JSON.parse(rawBody) as ZapiWebhookBody
  } catch {
    logAsyncEvent('warn', 'webhook.request.rejected', requestTrace, {
      request_id: requestId,
      reason: 'invalid_json',
    })
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const trace = extendAsyncEventTrace(requestTrace, {
    messageId: extractMessageId(body) ?? undefined,
  })
  logAsyncMetric('webhook.request.received', trace, {
    request_id: requestId,
    instance_id: body.instanceId ?? null,
    zapi_event: callbackType(body),
  })

  if (!secret) {
    logAsyncEvent('warn', 'webhook.request.rejected', trace, {
      request_id: requestId,
      reason: 'missing_url_secret',
    })
    return NextResponse.json({ error: 'Missing webhook secret' }, { status: 401 })
  }

  if (!body.instanceId) {
    logAsyncEvent('warn', 'webhook.request.rejected', trace, {
      request_id: requestId,
      reason: 'missing_instance_id',
    })
    return NextResponse.json({ error: 'Missing instanceId' }, { status: 400 })
  }

  let config: WhatsAppConfigRow | null = null
  try {
    config = await loadConfig(body.instanceId)
  } catch (error) {
    logAsyncEvent('error', 'webhook.request.rejected', trace, {
      request_id: requestId,
      reason: 'config_lookup_failed',
      ...errorFields(error),
    })
    return NextResponse.json({ error: 'Webhook config lookup failed' }, { status: 503 })
  }

  if (!config?.zapi_webhook_secret) {
    logAsyncEvent('warn', 'webhook.request.rejected', trace, {
      request_id: requestId,
      instance_id: body.instanceId,
      reason: 'unknown_instance',
    })
    return NextResponse.json({ error: 'Unknown WhatsApp instance' }, { status: 404 })
  }

  const expectedSecret = decrypt(config.zapi_webhook_secret)
  if (!safeEqual(secret, expectedSecret)) {
    logAsyncEvent('warn', 'webhook.request.rejected', trace, {
      request_id: requestId,
      instance_id: body.instanceId,
      reason: 'invalid_url_secret',
    })
    return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 403 })
  }

  const replayGuard = await acquireReplayGuard(body, rawBody, requestId, trace)
  if (replayGuard.status === 'error') {
    logAsyncEvent('error', 'webhook.request.rejected', trace, {
      request_id: requestId,
      reason: 'replay_guard_unavailable',
    })
    return NextResponse.json({ error: 'Webhook replay guard unavailable' }, { status: 503 })
  }
  if (replayGuard.status === 'duplicate') {
    logAsyncEvent('warn', 'webhook.request.dropped', trace, {
      request_id: requestId,
      instance_id: body.instanceId,
      zapi_event: callbackType(body),
      dedupeKey: replayGuard.dedupeKey,
      reason: 'replay_guard_duplicate',
    })
    return NextResponse.json({ status: 'received' }, { status: 200 })
  }

  const accountTrace = extendAsyncEventTrace(trace, {
    accountId: config.account_id,
  })

  after(async () => {
    const processingStartedAt = Date.now()
    try {
      await processZapiWebhook(config, body, accountTrace)
      await markReplayGuardProcessed(replayGuard.id, accountTrace)
      logAsyncMetric('webhook.processing.completed', accountTrace, {
        request_id: requestId,
        instance_id: body.instanceId,
        zapi_event: callbackType(body),
        duration_ms: durationMs(processingStartedAt),
      })
    } catch (error) {
      logAsyncEvent('error', 'webhook.processing.failed', accountTrace, {
        request_id: requestId,
        instance_id: body.instanceId,
        zapi_event: callbackType(body),
        ...errorFields(error),
        duration_ms: durationMs(processingStartedAt),
      })
      await releaseReplayGuard(replayGuard.id, accountTrace)
    } finally {
      await maybeCleanupExpiredReplayGuards()
    }
  })

  logAsyncMetric('webhook.acknowledged', accountTrace, {
    request_id: requestId,
    instance_id: body.instanceId,
    zapi_event: callbackType(body),
    duration_ms: durationMs(acknowledgedAt),
  })
  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processZapiWebhook(
  config: WhatsAppConfigRow,
  body: ZapiWebhookBody,
  trace: AsyncEventTrace
) {
  const type = callbackType(body)
  switch (type) {
    case 'ConnectedCallback':
      await handleConnectionStatus(config, body, true, trace)
      break
    case 'DisconnectedCallback':
      await handleConnectionStatus(config, body, false, trace)
      break
    case 'MessageStatusCallback':
      await handleMessageStatus(body, trace)
      break
    default:
      if (isReactionPayload(body)) {
        await handleInboundReaction(config, body, trace)
      } else {
        await handleInboundMessage(config, body, trace)
      }
      break
  }
}

async function handleConnectionStatus(
  config: WhatsAppConfigRow,
  body: ZapiWebhookBody,
  connected: boolean,
  trace: AsyncEventTrace
) {
  const failed = !connected && !!body.error
  const connectedPhone = connected
    ? normalizePhone(stringFrom(body.phone) ?? stringFrom(body.phoneDevice) ?? '')
    : null

  const { error } = await supabaseAdmin()
    .from('whatsapp_config')
    .update({
      status: connected ? 'connected' : 'disconnected',
      connection_status: connected ? 'CONNECTED' : failed ? 'FAILED' : 'DISCONNECTED',
      zapi_connected_phone: connectedPhone,
      ...(connected ? { connected_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', config.id)

  if (error) {
    logAsyncEvent('error', 'webhook.connection.failed', trace, {
      config_id: config.id,
      connected,
      ...errorFields(error),
    })
    return
  }

  logAsyncMetric('webhook.connection.completed', trace, {
    config_id: config.id,
    connected,
  })
}

const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

const MESSAGE_STATUS_LADDER = [
  'sending',
  'sent',
  'delivered',
  'read',
] as const

const ZAPI_STATUS_MAP: Record<string, string> = {
  SENT: 'sent',
  RECEIVED: 'delivered',
  READ: 'read',
  READ_BY_ME: 'read',
  PLAYED: 'read',
}

function ladderLevel(ladder: readonly string[], s: string): number {
  const idx = ladder.indexOf(s)
  return idx < 0 ? -1 : idx
}

function isValidRecipientStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') return false
  const ci = ladderLevel(RECIPIENT_STATUS_LADDER, current)
  const ii = ladderLevel(RECIPIENT_STATUS_LADDER, incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

function isValidMessageStatusTransition(current: string, incoming: string): boolean {
  if (current === 'failed') return false
  const ci = ladderLevel(MESSAGE_STATUS_LADDER, current)
  const ii = ladderLevel(MESSAGE_STATUS_LADDER, incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

async function handleMessageStatus(body: ZapiWebhookBody, trace: AsyncEventTrace) {
  const startedAt = Date.now()
  const zapiStatus = typeof body.status === 'string' ? body.status.toUpperCase() : ''
  const status = ZAPI_STATUS_MAP[zapiStatus]
  if (!status) {
    logAsyncEvent('warn', 'webhook.status.dropped', trace, {
      reason: 'unsupported_status',
      zapi_status: body.status ?? null,
    })
    return
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : []
  if (ids.length === 0 && body.messageId) ids.push(body.messageId)
  if (ids.length === 0) {
    logAsyncEvent('warn', 'webhook.status.dropped', trace, {
      reason: 'missing_message_ids',
      zapi_status: body.status ?? null,
    })
    return
  }

  for (const messageId of ids) {
    await applyMessageStatus(messageId, status, trace)
  }

  logAsyncMetric('webhook.status.completed', trace, {
    zapi_status: body.status,
    mapped_status: status,
    message_count: ids.length,
    duration_ms: durationMs(startedAt),
  })
}

async function applyMessageStatus(
  messageId: string,
  status: string,
  trace: AsyncEventTrace
) {
  const statusTrace = extendAsyncEventTrace(trace, { messageId })
  let messageStatusApplied: string | null = null
  let messageConversationId: string | null = null
  let messageAccountId: string | null = null

  const { data: messageRow, error: messageFetchErr } = await supabaseAdmin()
    .from('messages')
    .select('id, status, conversation_id, conversations(account_id)')
    .eq('message_id', messageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (messageFetchErr) {
    logAsyncEvent('error', 'webhook.status.failed', statusTrace, {
      reason: 'message_lookup_failed',
      ...errorFields(messageFetchErr),
    })
  } else if (
    messageRow &&
    isValidMessageStatusTransition(messageRow.status, status)
  ) {
    const { error: msgErr } = await supabaseAdmin()
      .from('messages')
      .update({ status })
      .eq('id', messageRow.id)

    if (msgErr) {
      logAsyncEvent('error', 'webhook.status.failed', statusTrace, {
        reason: 'message_status_update_failed',
        ...errorFields(msgErr),
      })
    } else {
      messageStatusApplied = status
      messageConversationId = messageRow.conversation_id
      const convValue = messageRow.conversations
      const conv = Array.isArray(convValue) ? convValue[0] : convValue
      messageAccountId = conv?.account_id ?? null
    }
  }

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', messageId)
    .maybeSingle()

  if (recFetchErr) {
    logAsyncEvent('error', 'webhook.status.failed', statusTrace, {
      reason: 'broadcast_recipient_lookup_failed',
      ...errorFields(recFetchErr),
    })
  } else if (
    recipient &&
    isValidRecipientStatusTransition(recipient.status, status)
  ) {
    const tsIso = new Date().toISOString()
    const update: Record<string, unknown> = { status }
    if (status === 'sent') update.sent_at = tsIso
    if (status === 'delivered') update.delivered_at = tsIso
    if (status === 'read') update.read_at = tsIso

    const { error: recUpdateErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id)

    if (recUpdateErr) {
      logAsyncEvent('error', 'webhook.status.failed', statusTrace, {
        reason: 'broadcast_recipient_update_failed',
        ...errorFields(recUpdateErr),
      })
    }
  }

  if (messageStatusApplied && messageConversationId && messageAccountId) {
    const accountTrace = extendAsyncEventTrace(statusTrace, {
      accountId: messageAccountId,
      conversationId: messageConversationId,
    })
    await dispatchWebhookEvent(
      supabaseAdmin(),
      messageAccountId,
      'message.status_updated',
      {
        whatsapp_message_id: messageId,
        conversation_id: messageConversationId,
        status: messageStatusApplied,
      }
    )
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringFrom(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = stringFrom(value)
    if (str) return str
  }
  return null
}

function objectString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null
  for (const key of keys) {
    const str = stringFrom(obj[key])
    if (str) return str
  }
  return null
}

function isUnsupportedChat(body: ZapiWebhookBody): boolean {
  const phone = stringFrom(body.phone) ?? ''
  return (
    body.isGroup === true ||
    body.isNewsletter === true ||
    phone.includes('@g.us') ||
    phone.includes('@newsletter')
  )
}

function isReactionPayload(body: ZapiWebhookBody): boolean {
  return !!asRecord(body.reaction)
}

function parseReaction(body: ZapiWebhookBody): {
  messageId: string | null
  emoji: string
} {
  const reaction = asRecord(body.reaction)
  return {
    messageId: objectString(reaction, ['messageId', 'msgId', 'id']),
    emoji: firstString(
      reaction?.reaction,
      reaction?.emoji,
      reaction?.value,
      reaction?.text,
      reaction?.message
    ) ?? '',
  }
}

async function handleInboundReaction(
  config: WhatsAppConfigRow,
  body: ZapiWebhookBody,
  trace: AsyncEventTrace
) {
  const { messageId, emoji } = parseReaction(body)
  if (!messageId) {
    logAsyncEvent('warn', 'webhook.reaction.dropped', trace, {
      reason: 'missing_target_message_id',
    })
    return
  }

  if (body.fromMe === true || isUnsupportedChat(body)) {
    logAsyncEvent('warn', 'webhook.reaction.dropped', trace, {
      reason: body.fromMe === true ? 'outbound_echo' : 'unsupported_chat_type',
    })
    return
  }

  const senderPhone = normalizePhone(stringFrom(body.phone) ?? '')
  if (!senderPhone) {
    logAsyncEvent('warn', 'webhook.reaction.dropped', trace, {
      reason: 'missing_sender_phone',
    })
    return
  }

  const existingContact = await findExistingContact(
    supabaseAdmin(),
    config.account_id,
    senderPhone
  )
  if (!existingContact) return

  const { data: conversation } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', config.account_id)
    .eq('contact_id', existingContact.id)
    .maybeSingle()
  if (!conversation) return

  const scopedTrace = extendAsyncEventTrace(trace, {
    contactId: existingContact.id,
    conversationId: conversation.id,
    messageId,
  })

  const { data: targetMsg } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', messageId)
    .eq('conversation_id', conversation.id)
    .maybeSingle()
  if (!targetMsg) return

  if (!emoji) {
    await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetMsg.id)
      .eq('actor_type', 'customer')
      .eq('actor_id', existingContact.id)
    logAsyncMetric('webhook.reaction.completed', scopedTrace, {
      action: 'removed',
    })
    return
  }

  await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetMsg.id,
        conversation_id: conversation.id,
        actor_type: 'customer',
        actor_id: existingContact.id,
        emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
  logAsyncMetric('webhook.reaction.completed', scopedTrace, {
    action: 'upserted',
  })
}

async function findCanonicalMessageByExternalId(
  messageId: string,
  trace: AsyncEventTrace
): Promise<MessageRowRef | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id, conversation_id, created_at')
    .eq('message_id', messageId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(2)

  if (error) {
    logAsyncEvent('error', 'webhook.message.failed', trace, {
      reason: 'canonical_message_lookup_failed',
      ...errorFields(error),
    })
    return null
  }

  const rows = (data as MessageRowRef[] | null) ?? []
  if (rows.length > 1) {
    logAsyncEvent('warn', 'webhook.message.dropped', trace, {
      reason: 'duplicate_message_rows_detected',
      canonical_message_id: rows[0]?.id ?? null,
      duplicate_count: rows.length,
    })
  }
  return rows[0] ?? null
}

async function persistInboundCustomerMessage(args: {
  conversationId: string
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  messageId: string
  createdAt: string
  replyToInternalId: string | null
  interactiveReplyId: string | null
}, trace: AsyncEventTrace): Promise<PersistInboundMessageResult> {
  const { data: inserted, error } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      sender_type: 'customer',
      content_type: args.contentType,
      content_text: args.contentText,
      media_url: args.mediaUrl,
      message_id: args.messageId,
      status: 'delivered',
      created_at: args.createdAt,
      reply_to_message_id: args.replyToInternalId,
      interactive_reply_id: args.interactiveReplyId,
    })
    .select('id, conversation_id, created_at')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const existing = await findCanonicalMessageByExternalId(args.messageId, trace)
      return { status: 'duplicate', existingId: existing?.id ?? null }
    }
    logAsyncEvent('error', 'webhook.message.failed', trace, {
      reason: 'inbound_message_insert_failed',
      ...errorFields(error),
    })
    return { status: 'error' }
  }

  const insertedRow = inserted as MessageRowRef
  const canonical = await findCanonicalMessageByExternalId(args.messageId, trace)
  if (canonical && canonical.id !== insertedRow.id) {
    const { error: cleanupError } = await supabaseAdmin()
      .from('messages')
      .delete()
      .eq('id', insertedRow.id)
    if (cleanupError) {
      logAsyncEvent('error', 'webhook.message.failed', trace, {
        reason: 'duplicate_message_cleanup_failed',
        inserted_message_id: insertedRow.id,
        canonical_message_id: canonical.id,
        ...errorFields(cleanupError),
      })
    }
    return { status: 'duplicate', existingId: canonical.id }
  }

  return { status: 'stored', row: insertedRow }
}

async function handleInboundMessage(
  config: WhatsAppConfigRow,
  body: ZapiWebhookBody,
  trace: AsyncEventTrace
) {
  const startedAt = Date.now()
  if (body.fromMe === true || isUnsupportedChat(body)) {
    logAsyncEvent('warn', 'webhook.message.dropped', trace, {
      reason: body.fromMe === true ? 'outbound_echo' : 'unsupported_chat_type',
    })
    return
  }

  const messageId = extractMessageId(body)
  if (!messageId) {
    logAsyncEvent('warn', 'webhook.message.dropped', trace, {
      reason: 'missing_external_message_id',
    })
    return
  }

  const senderPhone = normalizePhone(stringFrom(body.phone) ?? '')
  if (!senderPhone) {
    logAsyncEvent('warn', 'webhook.message.dropped', trace, {
      reason: 'missing_sender_phone',
      message_id: messageId,
    })
    return
  }

  const inboundTrace = extendAsyncEventTrace(trace, {
    accountId: config.account_id,
    messageId,
  })

  const existingMessage = await findCanonicalMessageByExternalId(messageId, inboundTrace)
  if (existingMessage) {
    logAsyncEvent('warn', 'webhook.message.dropped', extendAsyncEventTrace(inboundTrace, {
      conversationId: existingMessage.conversation_id,
    }), {
      reason: 'message_already_persisted',
      canonical_message_id: existingMessage.id,
    })
    return
  }

  const contactName =
    stringFrom(body.senderName) ?? stringFrom(body.chatName) ?? senderPhone

  const contactOutcome = await findOrCreateContact(
    config.account_id,
    config.user_id,
    senderPhone,
    contactName,
    inboundTrace
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact
  const contactTrace = extendAsyncEventTrace(inboundTrace, {
    contactId: contactRecord.id,
  })

  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contactRecord.id,
    contactTrace
  )
  if (!convResult) return
  const conversation = convResult.conversation
  const scopedTrace = extendAsyncEventTrace(contactTrace, {
    conversationId: conversation.id,
  })

  const { contentText, mediaUrl, contentType, interactiveReplyId, replyToMessageId } =
    parseZapiMessage(body)
  const momentMs = parseMomentMs(body.momment)
  const inboundCreatedAt = momentMs
    ? new Date(momentMs).toISOString()
    : new Date().toISOString()

  let replyToInternalId: string | null = null
  if (replyToMessageId) {
    const { data } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('message_id', replyToMessageId)
      .eq('conversation_id', conversation.id)
      .maybeSingle()
    replyToInternalId = data?.id ?? null
  }

  const storedMessage = await persistInboundCustomerMessage({
    conversationId: conversation.id,
    contentType,
    contentText,
    mediaUrl,
    messageId,
    createdAt: inboundCreatedAt,
    replyToInternalId,
    interactiveReplyId,
  }, scopedTrace)
  if (storedMessage.status === 'error') return
  if (storedMessage.status === 'duplicate') {
    logAsyncEvent('warn', 'webhook.message.dropped', scopedTrace, {
      reason: 'message_insert_race_duplicate',
      canonical_message_id: storedMessage.existingId,
    })
    return
  }

  const { count: customerMsgCount, error: countError } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  if (countError) {
    logAsyncEvent('error', 'webhook.message.failed', scopedTrace, {
      reason: 'customer_message_count_failed',
      ...errorFields(countError),
    })
  }
  const isFirstInboundMessage = (customerMsgCount ?? 0) === 1

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), config.account_id, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  const { error: conversationUpdateErr } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: inboundCreatedAt,
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
  if (conversationUpdateErr) {
    logAsyncEvent('error', 'webhook.message.failed', scopedTrace, {
      reason: 'conversation_update_failed',
      ...errorFields(conversationUpdateErr),
    })
  }

  await flagBroadcastReplyIfAny(config.account_id, contactRecord.id, scopedTrace)

  const flowMessage = interactiveReplyId
    ? {
        kind: 'interactive_reply' as const,
        reply_id: interactiveReplyId,
        reply_title: contentText ?? '',
        meta_message_id: messageId,
      }
    : {
        kind: 'text' as const,
        text: contentText ?? '',
        meta_message_id: messageId,
      }

  const flowResult = await dispatchInboundToFlows({
    accountId: config.account_id,
    userId: config.user_id,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: flowMessage,
    isFirstInboundMessage,
  })
  logAsyncMetric('webhook.flows.dispatched', scopedTrace, {
    consumed: flowResult.consumed,
    flow_outcome: flowResult.outcome,
  })
  const flowConsumed = flowResult.consumed
  const flowErrored = (flowResult as { outcome?: string }).outcome === 'error'

  const inboundText = contentText ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowErrored) {
    if (!flowConsumed) {
      automationTriggers.push('new_message_received', 'keyword_match')
    }
    if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
    if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
    for (const triggerType of automationTriggers) {
      runAutomationsForTrigger({
        accountId: config.account_id,
        triggerType,
        contactId: contactRecord.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
        },
      }).catch((err) =>
        logAsyncEvent('error', 'webhook.automation_dispatch.failed', scopedTrace, {
          trigger_type: triggerType,
          ...errorFields(err),
        })
      )
    }
  }

  void dispatchInboundToAgent({
    accountId: config.account_id,
    userId: config.user_id,
    contactId: contactRecord.id,
    conversationId: conversation.id,
  })

  await dispatchWebhookEvent(supabaseAdmin(), config.account_id, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: messageId,
    content_type: contentType,
    text: contentText,
  })
  logAsyncMetric('webhook.message.completed', scopedTrace, {
    content_type: contentType,
    flow_consumed: flowConsumed,
    automations_scheduled: automationTriggers.length,
    duration_ms: durationMs(startedAt),
  })
}

function parseText(value: unknown): string | null {
  if (typeof value === 'string') return value
  const obj = asRecord(value)
  return firstString(obj?.message, obj?.body, obj?.text, obj?.value)
}

function parseMedia(value: unknown, keys: string[]): {
  url: string | null
  caption: string | null
  filename: string | null
} {
  const obj = asRecord(value)
  return {
    url: objectString(obj, keys),
    caption: objectString(obj, ['caption', 'message', 'text']),
    filename: objectString(obj, ['fileName', 'filename', 'name']),
  }
}

function parseInteractive(value: unknown): {
  id: string | null
  title: string | null
} {
  const obj = asRecord(value)
  return {
    id: objectString(obj, ['buttonId', 'selectedButtonId', 'id', 'rowId', 'selectedRowId']),
    title: objectString(obj, ['message', 'title', 'text', 'selectedDisplayText']),
  }
}

function parseReplyTo(body: ZapiWebhookBody): string | null {
  const quoted = asRecord(body.quotedMsg)
  const referenced = asRecord(body.referenceMessage)
  return firstString(
    body.replyMessageId,
    body.quotedMessageId,
    quoted?.messageId,
    quoted?.id,
    referenced?.messageId,
    referenced?.id
  )
}

function parseZapiMessage(body: ZapiWebhookBody): {
  contentText: string | null
  mediaUrl: string | null
  contentType: string
  interactiveReplyId: string | null
  replyToMessageId: string | null
} {
  const replyToMessageId = parseReplyTo(body)

  const buttonReply = parseInteractive(body.buttonsResponseMessage)
  if (buttonReply.id) {
    return {
      contentText: buttonReply.title,
      mediaUrl: null,
      contentType: 'interactive',
      interactiveReplyId: buttonReply.id,
      replyToMessageId,
    }
  }

  const listReply = parseInteractive(body.listResponseMessage)
  if (listReply.id) {
    return {
      contentText: listReply.title,
      mediaUrl: null,
      contentType: 'interactive',
      interactiveReplyId: listReply.id,
      replyToMessageId,
    }
  }

  const text = parseText(body.text)
  if (text !== null) {
    return {
      contentText: text,
      mediaUrl: null,
      contentType: 'text',
      interactiveReplyId: null,
      replyToMessageId,
    }
  }

  const image = parseMedia(body.image, ['imageUrl', 'url', 'link', 'mediaUrl'])
  if (image.url) {
    return {
      contentText: image.caption,
      mediaUrl: image.url,
      contentType: 'image',
      interactiveReplyId: null,
      replyToMessageId,
    }
  }

  const video = parseMedia(body.video, ['videoUrl', 'url', 'link', 'mediaUrl'])
  if (video.url) {
    return {
      contentText: video.caption,
      mediaUrl: video.url,
      contentType: 'video',
      interactiveReplyId: null,
      replyToMessageId,
    }
  }

  const document = parseMedia(body.document, ['documentUrl', 'url', 'link', 'mediaUrl'])
  if (document.url) {
    return {
      contentText: document.caption ?? document.filename,
      mediaUrl: document.url,
      contentType: 'document',
      interactiveReplyId: null,
      replyToMessageId,
    }
  }

  const audio = parseMedia(body.audio, ['audioUrl', 'url', 'link', 'mediaUrl'])
  if (audio.url) {
    return {
      contentText: audio.caption,
      mediaUrl: audio.url,
      contentType: 'audio',
      interactiveReplyId: null,
      replyToMessageId,
    }
  }

  const fallbackType = typeof body.type === 'string' ? body.type : 'text'
  return {
    contentText: firstString(body.message, body.caption) ?? `[${fallbackType}]`,
    mediaUrl: null,
    contentType: 'text',
    interactiveReplyId: null,
    replyToMessageId,
  }
}

async function flagBroadcastReplyIfAny(
  accountId: string,
  contactId: string,
  trace: AsyncEventTrace
) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)
  } catch (err) {
    logAsyncEvent('error', 'webhook.message.failed', trace, {
      reason: 'broadcast_reply_flag_failed',
      ...errorFields(err),
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any
interface ConversationRow {
  id: string
  unread_count?: number | null
  created_at?: string | null
  [key: string]: unknown
}

interface ContactOutcome {
  contact: ContactRow
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
  trace: AsyncEventTrace
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingContact(
    supabaseAdmin(),
    accountId,
    phone
  )

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    logAsyncEvent('error', 'webhook.message.failed', trace, {
      reason: 'contact_create_failed',
      phone,
      ...errorFields(createError),
    })
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  trace: AsyncEventTrace
) {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(2)

  if (findError) {
    logAsyncEvent('error', 'webhook.message.failed', trace, {
      reason: 'conversation_lookup_failed',
      ...errorFields(findError),
    })
    return null
  }

  const existing = (existingRows as ConversationRow[] | null) ?? []
  if (existing.length > 1) {
    logAsyncEvent('warn', 'webhook.message.dropped', trace, {
      reason: 'duplicate_conversations_detected',
      canonical_conversation_id: existing[0]?.id ?? null,
      duplicate_count: existing.length,
    })
  }
  if (existing[0]) {
    return { conversation: existing[0], created: false }
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single()

  if (createError) {
    logAsyncEvent('error', 'webhook.message.failed', trace, {
      reason: 'conversation_create_failed',
      ...errorFields(createError),
    })
    return null
  }

  const { data: canonicalRows, error: canonicalError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (canonicalError) {
    logAsyncEvent('error', 'webhook.message.failed', trace, {
      reason: 'conversation_reconcile_failed',
      ...errorFields(canonicalError),
    })
    return { conversation: newConv, created: true }
  }

  const canonical = ((canonicalRows as ConversationRow[] | null) ?? [])[0]
  if (canonical && canonical.id !== newConv.id) {
    const { error: cleanupError } = await supabaseAdmin()
      .from('conversations')
      .delete()
      .eq('id', newConv.id)
    if (cleanupError) {
      logAsyncEvent('error', 'webhook.message.failed', trace, {
        reason: 'duplicate_conversation_cleanup_failed',
        inserted_conversation_id: newConv.id,
        canonical_conversation_id: canonical.id,
        ...errorFields(cleanupError),
      })
    }
    return { conversation: canonical, created: false }
  }

  return { conversation: canonical ?? newConv, created: true }
}
