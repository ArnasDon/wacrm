// ============================================================
// EngagementEvent writer — §16: "Add EngagementEvent writes into
// that pipeline rather than building a parallel ingestion path."
//
// One function, called from inside the existing status-update /
// reaction / inbound-reply handlers (`inbound-events.ts`) rather than
// a second event-ingestion route — exactly what §16 asks for. Both
// the real Meta webhook and the demo simulator (`demo-simulate.ts`)
// go through those same handlers, so both write here identically;
// `source` is the only thing that tells them apart afterward.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type EngagementEventType =
  | 'DELIVERED'
  | 'READ'
  | 'REACTION'
  | 'REPLY'
  | 'CLICK'
  | 'LEAD'
  | 'TRIAL'
  | 'CONVERSION';

export interface WriteEngagementEventInput {
  accountId: string;
  /** contacts.id — who this event is about. Null when unresolvable. */
  memberId: string | null;
  /** broadcasts.id — which post this event is engagement with. Null
   *  when the event isn't tied to any broadcast (e.g. a reaction on a
   *  plain 1:1 agent message). */
  postId: string | null;
  eventType: EngagementEventType;
  eventValue?: number | null;
  /** 'whatsapp' for a real Meta-driven event, 'demo' for a simulated
   *  one — the one thing that keeps the two apart in a shared table
   *  (§20). Callers should never invent a third value casually; the
   *  seed script's 'demo_seed' is the third, seed-time-only case. */
  source: string;
  /** Never put customer message text in here — §16 explicitly calls
   *  out `flow_run_events` storing reply *length*, not content, for
   *  this exact reason. Keep the same discipline here. */
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

/**
 * Append one row to `engagement_events`. Best-effort — a failure here
 * must never break the status/reaction/inbound processing it's
 * attached to, so every error is logged and swallowed, never thrown.
 */
export async function writeEngagementEvent(
  db: SupabaseClient,
  input: WriteEngagementEventInput
): Promise<void> {
  try {
    // campaign_id is reachable via broadcasts.content_id ->
    // content.campaign_id (migrations 046/053) — resolved here so
    // every caller gets it for free rather than each doing its own
    // two-table walk.
    let campaignId: string | null = null;
    if (input.postId) {
      const { data: broadcast } = await db
        .from('broadcasts')
        .select('content_id')
        .eq('id', input.postId)
        .maybeSingle();
      if (broadcast?.content_id) {
        const { data: content } = await db
          .from('content')
          .select('campaign_id')
          .eq('id', broadcast.content_id)
          .maybeSingle();
        campaignId = content?.campaign_id ?? null;
      }
    }

    const { error } = await db.from('engagement_events').insert({
      account_id: input.accountId,
      member_id: input.memberId,
      post_id: input.postId,
      campaign_id: campaignId,
      event_type: input.eventType,
      event_value: input.eventValue ?? null,
      source: input.source,
      metadata: input.metadata ?? {},
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    });
    if (error) {
      console.error('[engagement] write failed:', error.message);
    }
  } catch (err) {
    console.error(
      '[engagement] write threw:',
      err instanceof Error ? err.message : err
    );
  }
}
