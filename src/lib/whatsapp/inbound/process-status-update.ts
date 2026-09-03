import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboundStatus } from './types';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
export const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const;

export function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s);
  return idx < 0 ? -1 : idx;
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
export function isValidStatusTransition(
  current: string,
  incoming: string
): boolean {
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

// The exact set `messages_status_check` (migration 001) allows. A
// provider's status vocabulary isn't guaranteed to stay inside it —
// confirmed in production: UAZAPI sends "FileDownloaded" (a
// media-pipeline notice, not a delivery status) through this same
// path. Writing an unrecognized value straight into `messages.status`
// crashed the whole request on the DB's CHECK constraint.
const MESSAGE_STATUS_VALUES = new Set([
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
]);

export async function processStatusUpdate(
  db: SupabaseClient,
  s: InboundStatus
): Promise<void> {
  // 1) Mirror onto messages (legacy behavior). No `.select()`:
  //    message_id is NOT unique (migration 009 — Meta ids repeat
  //    across numbers), so this updates 0..N rows and must not assume
  //    a single row. Skipped entirely for a status value outside the
  //    CHECK constraint — see MESSAGE_STATUS_VALUES above.
  if (MESSAGE_STATUS_VALUES.has(s.status)) {
    const { error: msgErr } = await db
      .from('messages')
      .update({ status: s.status })
      .eq('message_id', s.providerMessageId);

    if (msgErr) {
      console.error('Error updating message status:', msgErr);
    }
  }

  // Webhook fan-out for this status change happens at the END of this
  // handler (after the broadcast mirror below), so a slow subscriber
  // endpoint can't delay the broadcast_recipients update.

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  //    `s.timestamp` isn't guaranteed valid — a malformed/absent
  //    source field upstream can produce `new Date(NaN)`, and
  //    `.toISOString()` throws on that (confirmed in production,
  //    alongside the FileDownloaded case above — same event, both
  //    fields off). `sent_at`/`delivered_at`/`read_at` are nullable;
  //    write null rather than crash the request.
  const tsIso = Number.isNaN(s.timestamp.getTime())
    ? null
    : s.timestamp.toISOString();

  const { data: recipient, error: recFetchErr } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', s.providerMessageId)
    .maybeSingle();

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr);
  } else if (
    recipient &&
    // Guard transitions — forward-only on the success ladder, and
    // `failed` only from pre-delivered states.
    isValidStatusTransition(recipient.status, s.status)
  ) {
    const update: Record<string, unknown> = { status: s.status };
    if (s.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso;
    if (s.status === 'delivered') update.delivered_at = tsIso;
    if (s.status === 'read') update.read_at = tsIso;

    const { error: recUpdateErr } = await db
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id);

    if (recUpdateErr) {
      console.error('Error updating broadcast recipient status:', recUpdateErr);
    }
  }

  // 3) Webhook fan-out for messages we store (inbox / API sends).
  //    Runs last so a slow subscriber can't delay the mirrors above.
  //    Bounded to one row (message_id isn't unique) purely to resolve
  //    the owning account for delivery.
  const { data: msgRow } = await db
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', s.providerMessageId)
    .limit(1)
    .maybeSingle();

  if (msgRow) {
    // Double cast: the route used an `any`-typed admin client where a single
    // cast sufficed; against a real SupabaseClient the conversations(account_id)
    // embed type needs `as unknown as`.
    const conv = msgRow.conversations as unknown as {
      account_id: string;
    } | null;
    const accountId = conv?.account_id;
    if (accountId) {
      await dispatchWebhookEvent(db, accountId, 'message.status_updated', {
        whatsapp_message_id: s.providerMessageId,
        conversation_id: msgRow.conversation_id,
        status: s.status,
      });
    }
  }
}
