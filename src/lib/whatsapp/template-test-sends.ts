// ============================================================
// Template test sends (migration 048) — the Templates page's test tool
// records each send by wamid so the status webhooks Meta posts for it
// can be shown live. Service-role only.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** A raw `statuses[]` entry from Meta's webhook — kept verbatim. */
export type MetaStatusEvent = { id: string; status: string } & Record<string, unknown>;

/**
 * Append a status webhook to its test send, if `event.id` is one.
 * Called for every status the webhook receives; a miss (the common
 * case — a real message) is one indexed lookup. Never throws: test-tool
 * bookkeeping must not break webhook processing.
 */
export async function recordTestSendStatus(
  db: SupabaseClient,
  event: MetaStatusEvent
): Promise<void> {
  try {
    const { data: row } = await db
      .from('template_test_sends')
      .select('id, statuses')
      .eq('wamid', event.id)
      .maybeSingle();
    if (!row) return;
    const statuses = Array.isArray(row.statuses) ? row.statuses : [];
    await db
      .from('template_test_sends')
      .update({ statuses: [...statuses, event], last_status: event.status })
      .eq('id', row.id);
  } catch (err) {
    console.warn('[template-test] could not record status webhook:', err);
  }
}
