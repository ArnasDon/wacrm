// ============================================================
// Demo-mode event simulation — the "delivery, read, reaction" half of
// §3's `DemoWhatsAppService (simulated send, delivery, read, reaction,
// inbound)`.
//
// These call the SAME handlers the real Meta webhook uses
// (`src/lib/whatsapp/inbound-events.ts`), constructing a synthetic
// event in the identical shape a real webhook payload would carry.
// That is deliberate, not a shortcut: §20 requires demo mode to write
// into the same tables production analytics reads, and the only way
// to guarantee identical downstream effects (message status,
// broadcast_recipients counters, webhook fan-out) is to run identical
// code, not a parallel demo-flavoured copy that could drift from it.
//
// Call sites invoke `simulateDemoDeliveryAndRead` right after
// persisting a demo-sent message — see send-message.ts,
// automations/meta-send.ts, flows/meta-send.ts, broadcast-core.ts,
// and the dashboard broadcast route. Best-effort: a simulation
// failure must never fail the send it's decorating, so every export
// here swallows its own errors (logged, not thrown) — matching the
// existing "pause the Flow run on agent send" precedent in
// send-message.ts.
//
// `simulateDemoReaction` is exported but not yet called from
// anywhere — reaction simulation needs a conversationId/contactId
// pair that isn't threaded through every send call site (e.g. the
// per-recipient broadcast loop doesn't currently carry contactId past
// the initial resolve step). Wiring it into the full demo funnel is
// Phase 3/4 work (docs/RIMULA_BUILD_SPEC.md §23); the capability is
// ready for that phase to call.
// ============================================================

import { randomUUID } from 'node:crypto';
import {
  handleStatusUpdate,
  handleReaction,
} from '@/lib/whatsapp/inbound-events';

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
    await handleStatusUpdate({
      id: waMessageId,
      status: 'delivered',
      timestamp,
      recipient_id: '',
    });
    await handleStatusUpdate({
      id: waMessageId,
      status: 'read',
      timestamp,
      recipient_id: '',
    });
  } catch (err) {
    console.error(
      '[demo-simulate] delivery/read simulation failed:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Simulate a customer reacting to a demo-sent message. Not wired into
 * any call site yet — see file header.
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
      contactId
    );
  } catch (err) {
    console.error(
      '[demo-simulate] reaction simulation failed:',
      err instanceof Error ? err.message : err
    );
  }
}
