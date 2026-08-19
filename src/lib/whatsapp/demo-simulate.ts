// ============================================================
// Demo-mode event simulation — the "delivery, read, reaction, inbound"
// half of §3's `DemoWhatsAppService (simulated send, delivery, read,
// reaction, inbound)`.
//
// `simulateDemoDeliveryAndRead` / `simulateDemoReaction` call the SAME
// handlers the real Meta webhook uses (`src/lib/whatsapp/
// inbound-events.ts`), constructing a synthetic event in the identical
// shape a real webhook payload would carry. That is deliberate, not a
// shortcut: §20 requires demo mode to write into the same tables
// production analytics reads, and the only way to guarantee identical
// downstream effects (message status, broadcast_recipients counters,
// webhook fan-out, EngagementEvent writes) is to run identical code,
// not a parallel demo-flavoured copy that could drift from it. Every
// call into `inbound-events.ts` here passes `source: 'demo'` — the one
// thing that keeps a simulated event apart from a real one in the
// shared `engagement_events` table (§20).
//
// `simulateDemoBroadcastReaction` / `simulateDemoInboundMessage` cover
// the broadcast/content-publish path, which is structurally different:
// a broadcast send never creates a `messages` row (broadcast_recipients
// tracks delivery on its own), so there is no target message for
// `handleReaction`'s `message_reactions` upsert to attach to, and no
// conversation guaranteed to exist for the recipient yet. Reaction
// there is a direct `engagement_events` write (§13: an EngagementEvent
// is fundamentally "engagement with a post", which a raw reaction-to-
// a-broadcast already is without needing a `message_reactions` row);
// inbound reply resolves/creates the conversation via the same
// `findOrCreateConversation` a real inbound webhook would use, then
// inserts a message exactly as `processMessage` would for a genuine
// customer reply.
//
// Call sites: `simulateDemoDeliveryAndRead` and `simulateDemoReaction`
// from send-message.ts (and, for delivery/read only,
// automations/meta-send.ts, flows/meta-send.ts); `simulateDemoBroadcastReaction`
// and `simulateDemoInboundMessage` from broadcast-core.ts's
// `deliverBroadcast` and content/deliver.ts's `deliverContentBroadcast`.
// Best-effort throughout: a simulation failure must never fail the
// send it's decorating, so every export here swallows its own errors
// (logged, not thrown).
//
// Deliberately NOT built here: dispatching a simulated inbound reply
// to Flows/automations/AI-reply, or creating a CustomerRequest from
// it. That starts blurring into the CustomerRequest/Lead funnel Phase
// 6 (docs/RIMULA_BUILD_SPEC.md §23) owns; this phase's scope is the
// engagement-event chain, not the commercial funnel behind it.
// ============================================================

import { randomUUID } from 'node:crypto';
import {
  handleStatusUpdate,
  handleReaction,
  flagBroadcastReplyIfAny,
} from '@/lib/whatsapp/inbound-events';
import { writeEngagementEvent } from '@/lib/whatsapp/engagement';
import { findOrCreateConversation } from '@/lib/whatsapp/find-or-create';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { supabaseAdmin } from '@/lib/automations/admin-client';

const DEMO_SOURCE = 'demo';

function nowEpochSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

/**
 * Advance a just-sent demo message through `delivered` then `read`,
 * using the exact same status-update handler a real Meta webhook
 * status callback would invoke. `waMessageId` is the provider message
 * id `DemoWhatsAppService` returned (a `demo-...` id) — the same value
 * already persisted as `messages.message_id` by the caller.
 */
export async function simulateDemoDeliveryAndRead(
  waMessageId: string
): Promise<void> {
  try {
    const timestamp = nowEpochSeconds();
    await handleStatusUpdate(
      { id: waMessageId, status: 'delivered', timestamp, recipient_id: '' },
      DEMO_SOURCE
    );
    await handleStatusUpdate(
      { id: waMessageId, status: 'read', timestamp, recipient_id: '' },
      DEMO_SOURCE
    );
  } catch (err) {
    console.error(
      '[demo-simulate] delivery/read simulation failed:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Simulate a customer reacting to a demo-sent 1:1 conversation
 * message (a real `messages` row must already exist for
 * `waMessageId` — this is NOT for broadcast sends, which never create
 * one; see `simulateDemoBroadcastReaction` for those).
 */
export async function simulateDemoReaction(
  waMessageId: string,
  conversationId: string,
  contactId: string,
  emoji = '👍'
): Promise<void> {
  try {
    await handleReaction(
      {
        id: `demo-reaction-${randomUUID()}`,
        from: '',
        timestamp: nowEpochSeconds(),
        type: 'reaction',
        reaction: { message_id: waMessageId, emoji },
      },
      conversationId,
      contactId,
      DEMO_SOURCE
    );
  } catch (err) {
    console.error(
      '[demo-simulate] reaction simulation failed:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Simulate a customer reacting to a demo broadcast/content send.
 * Unlike `simulateDemoReaction`, there is no `messages` row to attach
 * a `message_reactions` upsert to (broadcasts never create one), so
 * this writes the `engagement_events` row directly instead of routing
 * through `handleReaction`.
 */
export async function simulateDemoBroadcastReaction(
  accountId: string,
  broadcastId: string,
  contactId: string,
  emoji = '👍'
): Promise<void> {
  try {
    await writeEngagementEvent(supabaseAdmin(), {
      accountId,
      memberId: contactId,
      postId: broadcastId,
      eventType: 'REACTION',
      source: DEMO_SOURCE,
      metadata: { emoji },
    });
  } catch (err) {
    console.error(
      '[demo-simulate] broadcast reaction simulation failed:',
      err instanceof Error ? err.message : err
    );
  }
}

/** A small, deliberately generic pool — never fabricate customer-
 *  sounding claims or specifics (§2), just plausible short
 *  acknowledgments a demo conversation can show in the inbox. */
const DEMO_INBOUND_REPLIES = [
  'Thanks for the update!',
  'Got it, appreciate it.',
  '👍',
  'Sounds good, thank you.',
  'Noted, thanks!',
];

function pickDemoReplyText(): string {
  return DEMO_INBOUND_REPLIES[
    Math.floor(Math.random() * DEMO_INBOUND_REPLIES.length)
  ];
}

/**
 * Simulate a customer replying, driving the exact same effects a real
 * inbound webhook message would for this contact: resolve/create their
 * conversation (`findOrCreateConversation` — the same lookup the real
 * webhook uses), insert a `messages` row, bump the conversation
 * summary, reopen it if closed, and flag/record the reply against any
 * outstanding broadcast (`flagBroadcastReplyIfAny`, which itself
 * writes the REPLY `engagement_events` row).
 *
 * Deliberately does NOT dispatch to Flows, automations, or AI-reply —
 * see the file header for why that's out of this phase's scope.
 */
export async function simulateDemoInboundMessage(
  accountId: string,
  contactId: string,
  text: string = pickDemoReplyText()
): Promise<void> {
  try {
    const admin = supabaseAdmin();

    const { data: account, error: accountErr } = await admin
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();
    if (accountErr || !account?.owner_user_id) {
      console.error(
        '[demo-simulate] could not resolve account owner for inbound simulation:',
        accountErr?.message
      );
      return;
    }
    const configOwnerUserId = account.owner_user_id as string;

    const convResult = await findOrCreateConversation(
      accountId,
      configOwnerUserId,
      contactId
    );
    if (!convResult) return;
    const conversation = convResult.conversation;

    const { data: inserted, error: msgError } = await admin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: text,
        message_id: `demo-inbound-${randomUUID()}`,
        status: 'delivered',
      })
      .select('id')
      .single();
    if (msgError || !inserted) {
      console.error(
        '[demo-simulate] inbound message insert failed:',
        msgError?.message
      );
      return;
    }

    const { error: bumpErr } = await admin.rpc('bump_conversation_on_inbound', {
      p_conversation_id: conversation.id,
      p_last_message_text: text,
    });
    if (bumpErr) {
      console.error(
        '[demo-simulate] conversation bump failed:',
        bumpErr.message
      );
    }

    await reopenClosedConversation(admin, conversation);
    await flagBroadcastReplyIfAny(accountId, contactId, DEMO_SOURCE);
  } catch (err) {
    console.error(
      '[demo-simulate] inbound simulation failed:',
      err instanceof Error ? err.message : err
    );
  }
}
