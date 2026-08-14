// ============================================================
// Provider-agnostic inbound processing.
//
// Extracted from src/app/api/whatsapp/webhook/route.ts's
// `processMessage`/`handleStatusUpdate`, which already did all of
// this work independently of Meta's payload shape — the only
// Meta-specific piece left behind in that route is parsing Meta's
// raw webhook JSON (and resolving Meta media ids via
// getMediaUrl/downloadMedia) into the `NormalizedInboundMessage`
// shape this file consumes. The new uazapi webhook route
// (src/app/api/uazapi/webhook/[accountId]/[secret]/route.ts) does the
// same normalization for uazapi's payload shape and calls the exact
// same functions here — contact/conversation dedup, message
// persistence, Flows/Automations/AI dispatch, and outbound webhook
// fan-out are identical regardless of which provider delivered the
// message.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export type NormalizedContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'interactive'
  | 'reaction'

export interface NormalizedInboundMessage {
  /** Provider's message id (Meta's wamid / uazapi's messageid). */
  externalId: string
  /** Sender's phone number, any format — normalized internally. */
  from: string
  /** Unix ms timestamp of when the message was sent. */
  timestampMs: number
  contentType: NormalizedContentType
  text: string | null
  mediaUrl: string | null
  interactiveReplyId: string | null
  /** External id of the message this one replies to (quote/swipe-reply). */
  replyToExternalId: string | null
  /** Only set when contentType === 'reaction'. */
  reaction?: { targetExternalId: string; emoji: string }
}

// ============================================================
// Contact / conversation dedup
// ============================================================

interface ContactRow {
  id: string
  phone: string
  name?: string | null
  avatar_url?: string | null
  /** 'individual' | 'group' | 'community' | 'channel' — see chat-classify.ts. */
  kind?: string
  [key: string]: unknown
}

interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created
   *  automation dispatch below. */
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
  avatarUrl?: string | null,
  kind: string = 'individual',
): Promise<ContactOutcome | null> {
  // Find an existing contact for this account by phone. The shared
  // helper pre-filters in SQL by the last-8-digit suffix (so we don't
  // pull every contact on every inbound message) then applies the
  // strict `phonesMatch` in JS on the small candidate set. The same
  // helper backs the manual contact form and CSV import, so all
  // paths agree on what "same number" means (issue #212).
  const existingContact = await findExistingContact(supabaseAdmin(), accountId, phone)

  if (existingContact) {
    const patch: Record<string, unknown> = {}
    if (name && name !== existingContact.name) patch.name = name
    // Refreshed opportunistically on every inbound message rather than
    // via a separate polling job — profile photos change rarely enough
    // that "update whenever we hear from this contact again" keeps it
    // reasonably fresh without extra infrastructure.
    if (avatarUrl && avatarUrl !== existingContact.avatar_url) patch.avatar_url = avatarUrl
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      await supabaseAdmin().from('contacts').update(patch).eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  // Create new contact. account_id is the tenancy column; user_id is
  // the NOT NULL FK audit column (no inbound message has a single
  // "user who created" it — we attribute to the WhatsApp config
  // owner as a stable default).
  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
      avatar_url: avatarUrl || null,
      kind,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race: a concurrent inbound delivery (or another path)
    // created this contact between our lookup and insert, and the
    // unique index (migration 022) rejected the duplicate. Re-resolve
    // the existing row instead of dropping the message.
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[inbound-core] error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  // Look for an existing conversation in this account, oldest-first.
  //
  // Deliberately NOT `.single()` — it errors on both 0 rows and ≥2
  // rows, and treating any error as "none found" would insert a new
  // row every time, snowballing into a wall of duplicate chats once
  // two conversations existed for a contact (issue #363, fixed by
  // migration 036). Ordering oldest-first and taking one row resolves
  // to the same canonical survivor that migration keeps.
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[inbound-core] error finding conversation:', findError)
    return null
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({ account_id: accountId, user_id: configOwnerUserId, contact_id: contactId })
    .select()
    .single()

  if (createError) {
    // Lost a race: a concurrent inbound delivery created the
    // conversation between our lookup and insert, and the unique
    // index (migration 036) rejected the duplicate. Re-resolve the
    // winning row instead of dropping the message.
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false }
      }
    }
    console.error('[inbound-core] error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast. Best-effort — failures here must
 * not break the main inbound-message flow.
 */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string): Promise<void> {
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
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('[inbound-core] error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('[inbound-core] flagBroadcastReplyIfAny failed:', err)
  }
}

/**
 * Resolve a provider-side message id into the matching internal UUID,
 * scoped to one conversation. Returns null when we never received the
 * parent (e.g. a swipe-reply to a message older than this CRM install).
 */
async function lookupInternalIdByExternalId(
  externalId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', externalId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[inbound-core] lookupInternalIdByExternalId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new
 * messages — they're per-(target, actor) state. Upserts/deletes on
 * `message_reactions`, never writes a row into `messages`.
 */
async function handleReaction(
  reaction: { targetExternalId: string; emoji: string },
  conversationId: string,
  contactId: string,
): Promise<void> {
  const targetInternalId = await lookupInternalIdByExternalId(reaction.targetExternalId, conversationId)
  if (!targetInternalId) {
    console.warn('[inbound-core] reaction target message not found; skipping', reaction.targetExternalId)
    return
  }

  // Empty emoji = removal (per Meta's Cloud API spec; uazapi follows
  // the same convention).
  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (delError) {
      console.error('[inbound-core] reaction delete failed:', delError.message)
    }
    return
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' },
    )
  if (upsertError) {
    console.error('[inbound-core] reaction upsert failed:', upsertError.message)
  }
}

// The messages.content_type CHECK constraint (migration 001 + 010)
// allows: text, image, document, audio, video, location, template,
// interactive. Anything outside that (a provider-specific type our
// normalization didn't map) falls back to 'text' so the insert never
// fails the constraint.
const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive',
])

export interface ProcessInboundMessageParams {
  accountId: string
  /** Always the admin who saved the WhatsApp config — stable default
   *  audit owner for inserts that need a NOT NULL user_id FK. */
  configOwnerUserId: string
  contactName: string
  /**
   * Contact's WhatsApp profile photo URL, when the provider makes one
   * available. Meta's Cloud API never does (no picture field on
   * `contacts[].profile`, confirmed against its webhook docs); uazapi
   * includes one on every inbound message already (no extra API call
   * needed); Z-API requires a dedicated lookup call, done by its
   * webhook route before calling this.
   */
  contactAvatarUrl?: string | null
  /**
   * 'individual' (default) | 'group' | 'community' | 'channel' — see
   * chat-classify.ts. Only meaningful on first contact; an existing
   * contact's kind is never overwritten (a chat's fundamental type
   * doesn't change). Group/community/channel chats still get a full
   * contact + conversation + message row (so they show up in the
   * inbox, filed under their own filter — see conversation-list.tsx),
   * but skip flows/automations/AI auto-reply below: those are meant
   * to react to an individual customer, and firing them into a shared
   * group would be a real hazard (mass-messaging a group, replying to
   * every member's message, etc.), not just a wrong-target bug.
   */
  contactKind?: string
  message: NormalizedInboundMessage
}

/**
 * Process one inbound message (or reaction) from any provider:
 * find-or-create the contact + conversation, persist the message
 * (or mirror the reaction), then dispatch Flows, Automations, AI
 * auto-reply, and outbound webhooks. Mirrors
 * webhook/route.ts::processMessage's control flow exactly — only the
 * Meta-specific payload parsing happened before this function was
 * called.
 */
export async function processInboundMessage(params: ProcessInboundMessageParams): Promise<void> {
  const { accountId, configOwnerUserId, contactName, contactAvatarUrl, contactKind, message } = params
  // Group/community/channel JIDs aren't real phone numbers — see
  // chat-classify.ts — so normalizePhone would just mangle them for
  // no benefit. Only normalize for an actual individual contact.
  const senderPhone = contactKind && contactKind !== 'individual' ? message.from : normalizePhone(message.from)

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName,
    contactAvatarUrl,
    contactKind ?? 'individual',
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact
  const isGroupChat = contactRecord.kind != null && contactRecord.kind !== 'individual'

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  // Emit conversation.created as soon as the thread is opened — BEFORE
  // the reaction short-circuit below — so a conversation first opened
  // by a reaction still fires the event, and a subscriber always sees
  // the thread open before its first message.received.
  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  // Reactions short-circuit here — they aren't messages. Never insert
  // into `messages`, never bump unread_count, never update
  // last_message_text.
  if (message.contentType === 'reaction') {
    if (message.reaction) {
      await handleReaction(message.reaction, conversation.id, contactRecord.id)
    }
    return
  }

  let replyToInternalId: string | null = null
  if (message.replyToExternalId) {
    replyToInternalId = await lookupInternalIdByExternalId(message.replyToExternalId, conversation.id)
    if (!replyToInternalId) {
      console.warn('[inbound-core] reply context parent not found:', message.replyToExternalId)
    }
  }

  const contentType = ALLOWED_CONTENT_TYPES.has(message.contentType) ? message.contentType : 'text'

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but
  // they've never messaged us before.
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: message.text,
    media_url: message.mediaUrl,
    message_id: message.externalId,
    status: 'delivered',
    created_at: new Date(message.timestampMs).toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: message.interactiveReplyId,
  })

  if (msgError) {
    console.error('[inbound-core] error inserting message:', msgError)
    return
  }

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: message.text || `[${message.contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (convError) {
    console.error('[inbound-core] error updating conversation:', convError)
  }

  // If this contact was a recent broadcast recipient, flag the reply
  // so the broadcast's `replied_count` advances (aggregate trigger,
  // migration 003). No-ops for a group (never a broadcast recipient).
  await flagBroadcastReplyIfAny(accountId, contactRecord.id)

  // ============================================================
  // Flow runner / Automations / AI auto-reply — individual chats
  // only. A group conversation still gets its message row and shows
  // up in the inbox (filed under the Groups filter), but none of
  // these react to it: a Flow or an AI auto-reply firing into a
  // shared group on every member's message would spam the group, not
  // help one customer — a materially different (and worse) failure
  // mode than just "wrong target."
  // ============================================================
  const inboundText = message.text ?? ''
  let flowConsumed = false
  if (!isGroupChat) {
    // If the runner consumes the message (advanced an active run or
    // started a new one), suppress the `new_message_received` +
    // `keyword_match` automation triggers for this inbound — the
    // customer is navigating the bot menu, not sending a fresh trigger
    // word that should fork into automations. The relationship-level
    // triggers (`new_contact_created`, `first_inbound_message`) still
    // fire regardless.
    const flowResult = await dispatchInboundToFlows({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      message: message.interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: message.interactiveReplyId,
            reply_title: message.text ?? '',
            meta_message_id: message.externalId,
          }
        : {
            kind: 'text',
            text: message.text ?? '',
            meta_message_id: message.externalId,
          },
      isFirstInboundMessage,
    })
    flowConsumed = flowResult.consumed

    // Fire any automations that react to this webhook event. Fire-and-
    // forget: a slow or failing automation must not block the caller's
    // 200 OK response to the provider.
    const automationTriggers: (
      | 'new_contact_created'
      | 'first_inbound_message'
      | 'new_message_received'
      | 'keyword_match'
      | 'interactive_reply'
    )[] = []
    if (!flowConsumed) {
      automationTriggers.push('new_message_received', 'keyword_match')
      if (message.interactiveReplyId) {
        automationTriggers.push('interactive_reply')
      }
    }
    if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
    if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
    for (const triggerType of automationTriggers) {
      runAutomationsForTrigger({
        accountId,
        triggerType,
        contactId: contactRecord.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
          interactive_reply_id: message.interactiveReplyId ?? undefined,
        },
      }).catch((err) => console.error('[automations] dispatch failed:', err))
    }

    // AI auto-reply. Runs only for plain-text inbound the deterministic
    // flow runner did NOT consume (flows win over the LLM), and only
    // when the account has enabled it.
    if (!flowConsumed && !message.interactiveReplyId && inboundText.trim()) {
      await dispatchInboundToAiReply({
        accountId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        configOwnerUserId,
      })
    }
  }

  // message.received webhook (public API).
  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: message.externalId,
    content_type: contentType,
    text: message.text,
  })
}

export interface MirrorAgentSentMessageParams {
  accountId: string
  configOwnerUserId: string
  contactName: string
  contactAvatarUrl?: string | null
  /** See ProcessInboundMessageParams.contactKind. */
  contactKind?: string
  message: NormalizedInboundMessage
}

/**
 * Record a message the agent (store owner or seller) sent directly
 * from their own phone — NOT through this CRM's send API. uazapi/
 * Z-API's webhooks report these with `fromMe: true`, and their
 * `chatid`/`phone` field still identifies the CUSTOMER (the chat
 * partner), the same as an inbound message — direction doesn't change
 * which conversation a message belongs to. Existing webhook routes
 * used to just `return` on `fromMe`, which correctly avoided
 * double-processing the CRM's OWN outbound sends (already covered by
 * `excludeMessages`/`notifySentByMe` at webhook-registration time) but
 * incorrectly discarded this legitimate case too, so a reply typed on
 * the phone never showed up back in the CRM.
 *
 * Deliberately much thinner than processInboundMessage: this message
 * was already delivered (by the phone, not by us), so there's nothing
 * to send — just mirror it into `messages` with `sender_type: 'agent'`
 * so the thread stays in sync. No automations/flows/AI-auto-reply
 * (those react to the CUSTOMER, not the agent's own message) and no
 * `first_inbound_message`/`new_contact_created` triggers for the same
 * reason. `unread_count` resets to 0 — the human already answered
 * from their phone, so there's nothing left pending in the CRM's own
 * view of this thread.
 */
export async function mirrorAgentSentMessage(params: MirrorAgentSentMessageParams): Promise<void> {
  const { accountId, configOwnerUserId, contactName, contactAvatarUrl, contactKind, message } = params
  const contactPhone = contactKind && contactKind !== 'individual' ? message.from : normalizePhone(message.from)

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    contactPhone,
    contactName,
    contactAvatarUrl,
    contactKind ?? 'individual',
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  // Reactions the agent added from their phone aren't mirrored in this
  // round — message_reactions.actor_type only distinguishes
  // 'agent'/'customer' by WHO reacted, and every existing write path
  // for an 'agent' reaction assumes it went through this CRM's own UI
  // (actor_id would need to be a user_id, not a contact_id, unlike
  // handleReaction()'s customer-shaped upsert). Narrow, documented gap
  // rather than writing a row shaped for the wrong actor type.
  if (message.contentType === 'reaction') return

  let replyToInternalId: string | null = null
  if (message.replyToExternalId) {
    replyToInternalId = await lookupInternalIdByExternalId(message.replyToExternalId, conversation.id)
  }

  const contentType = ALLOWED_CONTENT_TYPES.has(message.contentType) ? message.contentType : 'text'

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'agent',
    content_type: contentType,
    content_text: message.text,
    media_url: message.mediaUrl,
    message_id: message.externalId,
    status: 'sent',
    created_at: new Date(message.timestampMs).toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: message.interactiveReplyId,
  })

  if (msgError) {
    console.error('[inbound-core] error inserting agent-mirrored message:', msgError)
    return
  }

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: message.text || `[${message.contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (convError) {
    console.error('[inbound-core] error updating conversation for agent-mirrored message:', convError)
  }
}

// ============================================================
// Delivery/read status ladder — shared across providers.
// ============================================================

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch only
// valid from the early states (pending / sent) — once a message has
// been delivered or the user has read or replied, a later "failed"
// status event is a bug in the provider's pipeline or a spoof attempt
// and must be ignored.
const RECIPIENT_STATUS_LADDER = ['pending', 'sent', 'delivered', 'read', 'replied'] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on the ladder
  return ii > ci
}

export interface NormalizedStatusUpdate {
  /** Provider's message id this status update refers to. */
  externalId: string
  status: string
  timestampMs: number
}

/**
 * Mirror a delivery/read status update onto `messages.status` and
 * `broadcast_recipients` (via `whatsapp_message_id`, migration 003),
 * then fan it out to any subscribed outbound webhook. Identical logic
 * for every provider — the only provider-specific part is parsing the
 * raw status event into `NormalizedStatusUpdate` before calling this.
 */
export async function handleStatusUpdate(update: NormalizedStatusUpdate): Promise<void> {
  const db: SupabaseClient = supabaseAdmin()
  const tsIso = new Date(update.timestampMs).toISOString()

  // 1) Mirror onto messages (legacy behavior). No `.select()`:
  //    message_id is NOT unique (migration 009 — ids repeat across
  //    numbers), so this updates 0..N rows and must not assume a
  //    single row.
  const { error: msgErr } = await db
    .from('messages')
    .update({ status: update.status })
    .eq('message_id', update.externalId)
  if (msgErr) {
    console.error('[inbound-core] error updating message status:', msgErr)
  }

  // 2) Mirror onto broadcast_recipients. The aggregate trigger on
  //    broadcast_recipients (migrations 003/005) re-derives the
  //    parent broadcast's sent/delivered/read/failed counts
  //    automatically.
  const { data: recipient, error: recFetchErr } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', update.externalId)
    .maybeSingle()

  if (recFetchErr) {
    console.error('[inbound-core] error fetching broadcast recipient:', recFetchErr)
  } else if (recipient && isValidStatusTransition(recipient.status, update.status)) {
    const patch: Record<string, unknown> = { status: update.status }
    if (update.status === 'sent') patch.sent_at = tsIso
    if (update.status === 'delivered') patch.delivered_at = tsIso
    if (update.status === 'read') patch.read_at = tsIso

    const { error: recUpdateErr } = await db
      .from('broadcast_recipients')
      .update(patch)
      .eq('id', recipient.id)
    if (recUpdateErr) {
      console.error('[inbound-core] error updating broadcast recipient status:', recUpdateErr)
    }
  }

  // 3) Webhook fan-out for messages we store (inbox / API sends).
  //    Runs last so a slow subscriber can't delay the mirrors above.
  //    Bounded to one row (message_id isn't unique) purely to resolve
  //    the owning account for delivery.
  const { data: msgRow } = await db
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', update.externalId)
    .limit(1)
    .maybeSingle()

  if (msgRow) {
    // Supabase's inferred type for a many-to-one embed without
    // generated Database types is looser than the actual runtime
    // shape (a single object, not an array) — cast through `unknown`
    // the same way the pre-refactor inline handler effectively did
    // (its `supabaseAdmin()` returned `any`, sidestepping this).
    const conv = msgRow.conversations as unknown as { account_id: string } | null
    const accountId = conv?.account_id
    if (accountId) {
      await dispatchWebhookEvent(db, accountId, 'message.status_updated', {
        whatsapp_message_id: update.externalId,
        conversation_id: msgRow.conversation_id,
        status: update.status,
      })
    }
  }
}
