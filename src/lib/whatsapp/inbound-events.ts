// ============================================================
// Shared inbound-event handlers: message status updates and
// reactions.
//
// Extracted verbatim from the webhook route (`handleStatusUpdate` /
// `handleReaction` used to live there) so `DemoWhatsAppService` can
// drive the exact same downstream effects — `messages.status`,
// `broadcast_recipients` counters, the "replied" flip, webhook
// fan-out — for a *simulated* delivery/read/reaction as the real
// Meta webhook produces for a real one. This is what §20 means by
// "writing into the same tables production analytics reads — no
// parallel fake analytics system": there is exactly one code path
// that turns a status/reaction event into DB state, and both the
// real webhook and the demo simulator call it.
//
// Phase 4 adds EngagementEvent writes into these same handlers (§16:
// "Add EngagementEvent writes into that pipeline rather than building
// a parallel ingestion path") — every caller now passes a `source`
// ('whatsapp' for the real webhook, 'demo' for the simulator) so the
// two stay distinguishable in the shared `engagement_events` table.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { writeEngagementEvent } from '@/lib/whatsapp/engagement';

export interface WhatsAppReactionMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  reaction?: { message_id: string; emoji: string };
}

/** Default `source` for every handler below — the real Meta webhook
 *  never passes an explicit one, so it reads as 'whatsapp' by
 *  default; only the demo simulator overrides it. */
const REAL_SOURCE = 'whatsapp';

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays (real or simulated) must never regress a
// recipient back down this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const;

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s);
  return idx < 0 ? -1 : idx;
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent';
  }
  if (current === 'failed') {
    return false; // failed is terminal
  }
  const ci = ladderLevel(current);
  const ii = ladderLevel(incoming);
  if (ii < 0) return false; // unknown incoming status
  if (ci < 0) return true; // unknown current — accept anything on the ladder
  return ii > ci;
}

/**
 * Handle one message-status event — `id` is the provider message id
 * (a real Meta `wamid`, or a `demo-...` id for a simulated send).
 * Updates `messages.status`, mirrors onto `broadcast_recipients` when
 * the message belongs to a broadcast, fans the change out to outbound
 * webhook subscribers, and — for a broadcast-tied delivered/read —
 * writes a matching `engagement_events` row (§13: EngagementEvent is
 * about engagement with a *post*, so this is deliberately gated on
 * the message actually being a broadcast recipient, not written for
 * every plain 1:1 message's status change).
 */
export async function handleStatusUpdate(
  status: {
    id: string;
    status: string;
    timestamp: string;
    recipient_id: string;
  },
  source: string = REAL_SOURCE
) {
  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status. No
  //    `.select()`: message_id is NOT unique (migration 009 — Meta ids
  //    repeat across numbers), so this updates 0..N rows and must not
  //    assume a single row.
  const { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update({ status: status.status })
    .eq('message_id', status.id);

  if (msgErr) {
    console.error('Error updating message status:', msgErr);
  }

  // Webhook fan-out for this status change happens at the END of this
  // handler (after the broadcast mirror below), so a slow subscriber
  // endpoint can't delay the broadcast_recipients update.

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString();

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status, broadcast_id, contact_id, broadcasts!inner(account_id)')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle();

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr);
  } else if (
    recipient &&
    // Guard transitions — forward-only on the success ladder, and
    // `failed` only from pre-delivered states.
    isValidStatusTransition(recipient.status, status.status)
  ) {
    const update: Record<string, unknown> = { status: status.status };
    if (status.status === 'sent' && !('sent_at' in update))
      update.sent_at = tsIso;
    if (status.status === 'delivered') update.delivered_at = tsIso;
    if (status.status === 'read') update.read_at = tsIso;

    const { error: recUpdateErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id);

    if (recUpdateErr) {
      console.error('Error updating broadcast recipient status:', recUpdateErr);
    } else if (status.status === 'delivered' || status.status === 'read') {
      const broadcastMeta = recipient.broadcasts as unknown as
        | { account_id: string }
        | { account_id: string }[]
        | null;
      const account = Array.isArray(broadcastMeta) ? broadcastMeta[0] : broadcastMeta;
      if (account?.account_id) {
        await writeEngagementEvent(supabaseAdmin(), {
          accountId: account.account_id,
          memberId: recipient.contact_id,
          postId: recipient.broadcast_id,
          eventType: status.status === 'delivered' ? 'DELIVERED' : 'READ',
          source,
          occurredAt: tsIso,
        });
      }
    }
  }

  // 3) Webhook fan-out for messages we store (inbox / API sends).
  //    Runs last so a slow subscriber can't delay the mirrors above.
  //    Bounded to one row (message_id isn't unique) purely to resolve
  //    the owning account for delivery.
  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', status.id)
    .limit(1)
    .maybeSingle();

  if (msgRow) {
    const conv = msgRow.conversations as unknown as {
      account_id: string;
    } | null;
    const accountId = conv?.account_id;
    if (accountId) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        accountId,
        'message.status_updated',
        {
          whatsapp_message_id: status.id,
          conversation_id: msgRow.conversation_id,
          status: status.status,
        }
      );
    }
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast, and record a REPLY
 * `engagement_events` row.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
export async function flagBroadcastReplyIfAny(
  accountId: string,
  contactId: string,
  source: string = REAL_SOURCE
) {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet. Account-scoped so a shared inbox reply
    // marks the broadcast as replied regardless of which teammate
    // sent it.
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !recs || recs.length === 0) return;

    const row = recs[0];
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id);

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr);
      return;
    }

    await writeEngagementEvent(supabaseAdmin(), {
      accountId,
      memberId: contactId,
      postId: row.broadcast_id,
      eventType: 'REPLY',
      source,
    });
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err);
  }
}

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent
 * (e.g. a swipe-reply to a message older than this CRM install).
 */
export async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
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
 * skipped so the caller can still ack 200 to Meta. On a genuine add
 * (not a removal), also writes a REACTION `engagement_events` row —
 * `postId` is resolved via `broadcast_recipients.whatsapp_message_id`
 * when the target message happens to be a broadcast send, and left
 * null otherwise (a reaction on a plain 1:1 message still counts as
 * engagement, just not engagement *with a post*).
 */
export async function handleReaction(
  message: WhatsAppReactionMessage,
  conversationId: string,
  contactId: string,
  source: string = REAL_SOURCE
) {
  const reaction = message.reaction;
  if (!reaction?.message_id) return;

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  );
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    );
    return;
  }

  // Empty emoji = removal (per Meta's Cloud API spec).
  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
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
      { onConflict: 'message_id,actor_type,actor_id' }
    );
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message);
    return;
  }

  const { data: conversation } = await supabaseAdmin()
    .from('conversations')
    .select('account_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation?.account_id) return;

  const { data: recipient } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('broadcast_id')
    .eq('whatsapp_message_id', reaction.message_id)
    .maybeSingle();

  await writeEngagementEvent(supabaseAdmin(), {
    accountId: conversation.account_id,
    memberId: contactId,
    postId: recipient?.broadcast_id ?? null,
    eventType: 'REACTION',
    source,
    metadata: { emoji: reaction.emoji },
  });
}
