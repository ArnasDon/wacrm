// ============================================================
// Núcleo do pipeline de mensagens recebidas.
//
// Consome um `InboundMessage` já normalizado (o adaptador de cada
// provedor produz a forma) e faz TODO o trabalho pós-envelope: contato
// / conversa (por `connection_id`), persistência idempotente, espelho
// de mídia via `transport.fetchMedia`, e o fan-out para Flows /
// Automations / AI / webhooks públicos.
//
// Recorte quase-verbatim de `processMessage` da rota da Meta. A cabeça
// (decisão por `content.kind`) e o caminho de mídia (`fetchMedia` no
// lugar de `getMediaUrl`+`downloadMedia` inline) foram reescritos; o
// resto — incluindo os comentários de ORDENAÇÃO — é o que era.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { createTransport } from '@/lib/whatsapp/providers';
import type { TransportConnection } from '@/lib/whatsapp/providers';
import { mirrorInboundMedia } from '@/lib/whatsapp/mirror-inbound-media';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

import type { InboundMessage } from './types';
import {
  findOrCreateContact,
  findOrCreateConnectionAwareConversation,
} from './find-or-create';

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent
 * (e.g. a swipe-reply to a message older than this CRM install).
 */
async function lookupInternalIdByMetaId(
  db: SupabaseClient,
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 *
 * Best-effort: a missing parent (we never received it) is logged and
 * skipped so the webhook still acks 200 to Meta.
 */
async function handleReaction(
  db: SupabaseClient,
  reaction: { targetProviderMessageId: string; emoji: string },
  conversationId: string,
  contactId: string
) {
  if (!reaction.targetProviderMessageId) return;

  const targetInternalId = await lookupInternalIdByMetaId(
    db,
    reaction.targetProviderMessageId,
    conversationId
  );
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.targetProviderMessageId
    );
    return;
  }

  // Empty emoji = removal (per Meta's Cloud API spec).
  if (!reaction.emoji) {
    const { error: delError } = await db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message);
    }
    return;
  }

  const { error: upsertError } = await db.from('message_reactions').upsert(
    {
      message_id: targetInternalId,
      conversation_id: conversationId,
      actor_type: 'customer',
      actor_id: contactId,
      emoji: reaction.emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' }
  );
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message);
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(
  db: SupabaseClient,
  accountId: string,
  contactId: string
) {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet. Account-scoped so a shared inbox reply
    // marks the broadcast as replied regardless of which teammate
    // sent it.
    const { data: recs, error } = await db
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !recs || recs.length === 0) return;

    const row = recs[0];
    const { error: updErr } = await db
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id);

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr);
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err);
  }
}

/** Meta's message timestamp is epoch SECONDS; the mirror wants a string. */
function timestampSeconds(ts: Date): string {
  return String(Math.floor(ts.getTime() / 1000));
}

/**
 * Build a `TransportConnection` from a raw `whatsapp_connections` row the
 * same way `resolveConnection()` does — credential decrypted here, the
 * variant chosen by `row.provider`.
 */
function buildTransportConnection(row: {
  id: string;
  account_id: string;
  credential: string;
  provider?: string | null;
  phone_number_id?: string | null;
  uazapi_instance_id?: string | null;
  uazapi_base_url?: string | null;
}): TransportConnection {
  if (row.provider === 'uazapi') {
    return {
      id: row.id,
      accountId: row.account_id,
      credential: decrypt(row.credential),
      provider: 'uazapi',
      instanceId: row.uazapi_instance_id ?? '',
      baseUrl: row.uazapi_base_url ?? '',
    };
  }
  return {
    id: row.id,
    accountId: row.account_id,
    credential: decrypt(row.credential),
    provider: 'meta',
    phoneNumberId: row.phone_number_id ?? '',
  };
}

export async function processInboundMessage(
  db: SupabaseClient,
  msg: InboundMessage
): Promise<void> {
  const content = msg.content;

  // Find or create contact
  const contactOutcome = await findOrCreateContact(
    db,
    msg.accountId,
    msg.configOwnerUserId,
    msg.from,
    msg.senderName ?? ''
  );
  if (!contactOutcome) return;
  const contactRecord = contactOutcome.contact;

  // Find or create conversation — connection-aware: a contact reaching
  // the same account through two different connections gets two threads.
  const convResult = await findOrCreateConnectionAwareConversation(
    db,
    msg.accountId,
    msg.configOwnerUserId,
    contactRecord.id,
    msg.connectionId
  );
  if (!convResult) return;
  const conversation = convResult.conversation;

  // Emit conversation.created as soon as the thread is opened — BEFORE
  // the reaction short-circuit below — so a conversation first opened by
  // a reaction still fires the event, and a subscriber always sees the
  // thread open before its first message.received.
  if (convResult.created) {
    await dispatchWebhookEvent(db, msg.accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    });
  }

  // Reactions short-circuit here — they aren't messages. We never insert
  // into `messages`, never bump unread_count, never update last_message_text.
  // Done before the media-URL fetch so it's skipped.
  if (content.kind === 'reaction') {
    await handleReaction(
      db,
      {
        targetProviderMessageId: content.targetProviderMessageId,
        emoji: content.emoji,
      },
      conversation.id,
      contactRecord.id
    );
    return;
  }

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we just store NULL and the UI renders the message without a quote.
  let replyToInternalId: string | null = null;
  if (msg.replyToProviderMessageId) {
    replyToInternalId = await lookupInternalIdByMetaId(
      db,
      msg.replyToProviderMessageId,
      conversation.id
    );
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        msg.replyToProviderMessageId
      );
    }
  }

  // Insert message — field names MUST match the messages table schema
  // (see supabase/migrations/001_initial_schema.sql):
  //   conversation_id, sender_type, content_type, content_text,
  //   media_url, media_type, template_name, message_id, status,
  //   created_at

  // The messages.content_type CHECK constraint (widened in migration 010
  // to add 'interactive' for button/list taps) allows:
  //   text, image, document, audio, video, location, template, interactive
  // Map the normalized `content.kind` onto that vocabulary.
  const contentType =
    content.kind === 'media'
      ? content.mediaKind // image | video | document | audio
      : content.kind === 'location'
        ? 'location'
        : content.kind === 'interactive_reply'
          ? 'interactive'
          : 'text'; // text | unsupported → text fallback

  const contentText: string | null =
    content.kind === 'text'
      ? content.text || null
      : content.kind === 'media'
        ? (content.caption ?? null)
        : content.kind === 'location'
          ? [
              content.name,
              content.address,
              `${content.latitude},${content.longitude}`,
            ]
              .filter(Boolean)
              .join(' - ')
          : content.kind === 'interactive_reply'
            ? content.title
            : `[Unsupported message type: ${content.rawType}]`;

  // Only populated for content_type='interactive' (migration 010).
  const interactiveReplyId =
    content.kind === 'interactive_reply' ? content.replyId : null;

  // Media resolution (issue #466). Inbound attachments are copied into
  // the `chat-media` bucket so they outlive Meta's ~30-day retention.
  // Strictly BEST EFFORT: any failure falls back to the proxy URL for
  // Meta (`/api/whatsapp/media/<id>`), null for uazapi (1c-ii), and
  // never aborts the webhook — a throw would have Meta redeliver and
  // re-run everything downstream.
  let mediaUrl: string | null = null;
  let mediaType: string | null = null;
  if (content.kind === 'media') {
    const ref = content.ref;
    const mediaId = ref.provider === 'meta' ? ref.mediaId : undefined;
    // Key that makes the mirrored object path unique + redelivery-stable.
    // Meta: the media id. uazapi: the provider message id (the `3EB0…`
    // `messageid`) — unique per message, stable across redelivery. Using
    // `''` for uazapi collided every attachment onto one storage key.
    const mirrorKey =
      ref.provider === 'meta' ? ref.mediaId : msg.providerMessageId;
    const proxyFallback =
      ref.provider === 'meta' ? `/api/whatsapp/media/${mediaId}` : null;
    mediaType = content.mimeType ?? null;
    mediaUrl = proxyFallback;

    // Per-account opt-out (migration 039). Default ON — the column is
    // NOT NULL DEFAULT TRUE, but a row read before 039 lands has it
    // undefined and losing attachments is the failure mode to avoid.
    const { data: connRow } = await db
      .from('whatsapp_connections')
      .select('*')
      .eq('id', msg.connectionId)
      .single();

    if (connRow && connRow.mirror_inbound_media !== false) {
      try {
        const transport = createTransport(buildTransportConnection(connRow));
        const { bytes, mimeType, filename } = await transport.fetchMedia(ref);
        const mirrored = await mirrorInboundMedia({
          storage: db.storage,
          accountId: msg.accountId,
          mediaId: mirrorKey,
          bytes,
          mimeType,
          // The sender's own filename becomes the mirrored object's name.
          fileName: filename ?? content.filename,
          messageTimestamp: timestampSeconds(msg.timestamp),
          fileSize: bytes.byteLength,
        });
        mediaUrl = mirrored ?? proxyFallback;
        // Prefer the envelope's declared MIME; fall back to what the
        // transport resolved.
        mediaType = content.mimeType ?? mimeType;
      } catch (error) {
        console.warn(
          '[mirror-media] could not mirror inbound media:',
          error instanceof Error ? error.message : error
        );
        mediaUrl = proxyFallback;
      }
    }
  }

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before — which new_contact_created wouldn't catch.
  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer');
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  // Idempotent insert. Meta retries webhook deliveries (a slow ack, a
  // transient 5xx), and each retry replays the exact same message.id. The
  // unique index on (conversation_id, message_id) added in migration 037
  // makes a replay conflict; `ignoreDuplicates` turns that into an ON
  // CONFLICT DO NOTHING, and the `.select()` then returns the inserted row
  // ONLY on a genuine first insert — an empty result means this delivery
  // was a replay. This is the single idempotency boundary that must sit
  // BEFORE the unread bump and all downstream fan-out below (issue #367).
  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        // Meta's MIME type for the attachment (migration 039). Was
        // discarded before, which forced the download path to guess an
        // extension from the fetched blob — impossible to do until the
        // bytes had already been fetched successfully.
        media_type: mediaType,
        message_id: msg.providerMessageId,
        status: 'delivered',
        created_at: msg.timestamp.toISOString(),
        reply_to_message_id: replyToInternalId,
        // Only populated for content_type='interactive'. Migration 010 added
        // the column; null for every other content_type so existing inserts
        // behave identically.
        interactive_reply_id: interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id');

  if (msgError) {
    console.error('Error inserting message:', msgError);
    return;
  }

  // Replayed delivery: the message already exists, so acknowledge it as a
  // no-op. Returning here is what keeps a retry from double-bumping unread,
  // re-advancing flows, re-firing automations, re-invoking AI handling, and
  // re-dispatching public webhooks (issue #367).
  if (!insertedRows || insertedRows.length === 0) {
    console.info(
      '[webhook] duplicate inbound message ignored (idempotent replay):',
      msg.providerMessageId
    );
    return;
  }

  // Update conversation. The unread bump is done DB-side (migration 037's
  // bump_conversation_on_inbound) rather than as a read-modify-write of the
  // snapshot loaded above: two inbound messages for the same conversation
  // can process concurrently, and computing `snapshot + 1` in the app let
  // both reads see the same value and write the same increment, losing one
  // (issue #369). The RPC increments in a single UPDATE and refreshes the
  // last-message summary in the same statement.
  const { error: convError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: contentText || `[${fallbackLabel(content)}]`,
  });

  if (convError) {
    console.error('Error updating conversation:', convError);
  }

  // A customer writing again re-opens the thread (issue #409). Kept as a
  // separate conditional statement rather than a `status` field on the
  // update above so the write can be gated on the row's CURRENT status in
  // SQL — see the helper for why that matters.
  await reopenClosedConversation(db, conversation);

  // If this contact was a recent broadcast recipient, flag the reply
  // so the broadcast's `replied_count` advances (via the aggregate
  // trigger installed in migration 003).
  await flagBroadcastReplyIfAny(db, msg.accountId, contactRecord.id);

  const inboundText = contentText ?? '';

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word
  // that should fork into automations.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  //
  // Awaited (not fire-and-forget) because we need the `consumed`
  // result before deciding whether to dispatch automations. The
  // runner has its own try/catch and never throws. Accounts with
  // no active flows take the runner's early-exit "no_match" path
  // basically for free (one indexed SELECT for the active run).
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    accountId: msg.accountId,
    userId: msg.configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: interactiveReplyId,
          reply_title: contentText ?? '',
          meta_message_id: msg.providerMessageId,
        }
      : {
          kind: 'text',
          text: inboundText,
          meta_message_id: msg.providerMessageId,
        },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  // Fire any automations that react to this webhook event. All dispatches
  // run here (not earlier) so the contact, conversation, and inbound
  // message all exist before any step — including send_message — runs.
  // Fire-and-forget: a slow or failing automation must not block the
  // webhook's 200 OK response to Meta.
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = [];
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    // Interactive tap → fire the interactive_reply trigger too (only
    // meaningful when a button/list reply actually arrived). Enables
    // automation-only chained menus; when a Flow owns the menu it will
    // have consumed the reply and this is skipped.
    if (interactiveReplyId) {
      automationTriggers.push('interactive_reply');
    }
  }
  // new_contact_created fires only when the webhook just auto-created the
  // contact row. first_inbound_message fires whenever this is the contact's
  // first-ever customer-sent message — a superset that also catches
  // manually-imported contacts sending for the first time. We dispatch both
  // so users can pick whichever semantic they want; an automation that
  // listens to only one trigger runs only when that trigger matches.
  if (contactOutcome.wasCreated)
    automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage)
    automationTriggers.unshift('first_inbound_message');
  // Awaited — not fire-and-forget. We're inside the route's `after()`
  // block, which only keeps the function alive for promises it can see, so
  // a detached dispatch can be frozen part-way through: the log row is
  // inserted, then the steps never run. That is issue #301's failure mode
  // recurring one level down, and it's what issue #409 reported as runs
  // logging zero steps. `runAutomationsForTrigger` owns its own try/catch
  // and never throws; the `.catch` is belt-and-braces so one trigger
  // type's failure can't skip the rest of the loop.
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId: msg.accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        // Only set on interactive taps; drives the interactive_reply
        // trigger's exact-id match.
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err));
  }

  // AI auto-reply. Runs only for plain-text inbound the deterministic
  // flow runner did NOT consume (flows win over the LLM), and only when
  // the account has enabled it. Awaited inside `after()` (same reason as
  // the webhook dispatch below); `dispatchInboundToAiReply` owns its
  // eligibility gates + try/catch and never throws.
  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId: msg.accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId: msg.configOwnerUserId,
    });
  }

  // message.received webhook (public API). Awaited — not fire-and-forget
  // — because we're inside the route's `after()` block, which only keeps
  // the function alive for promises it can see; a detached promise could
  // be frozen before it delivers. `dispatchWebhookEvent` early-exits
  // when the account has no matching endpoint and never throws.
  // (conversation.created is emitted earlier, right after the thread is
  // opened.)
  await dispatchWebhookEvent(db, msg.accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: msg.providerMessageId,
    content_type: contentType,
    text: contentText,
  });
}

/**
 * The bracketed label for `bump_conversation_on_inbound`'s
 * last-message summary when there's no text — `[image]`, `[location]`,
 * `[contacts]`. Mirrors the old `[${message.type}]`: the media kind, not
 * the literal `'media'`; the raw type for anything unsupported.
 */
function fallbackLabel(content: InboundMessage['content']): string {
  if (content.kind === 'media') return content.mediaKind;
  if (content.kind === 'unsupported') return content.rawType;
  if (content.kind === 'interactive_reply') return 'interactive';
  return content.kind; // text | location | reaction
}
