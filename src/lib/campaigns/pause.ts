// Stopping a campaign from inside a sender (delivery settings "Pause on
// quality hold" / "Stop on Meta API error").
//
// The stop is FINAL — the campaign cannot be resumed or retried:
//   - its status goes 'sending' → 'failed' and `config.stopped_reason`
//     records why (the resume route refuses any campaign carrying it);
//   - recipients still pending are then marked failed with that reason
//     by `closeStoppedRecipients` — nothing is left for a runner, a
//     Kafka worker or the scheduler to pick up.
//
// Closing is deliberately a separate step: the result writer only
// updates rows that are still 'pending', so a send in flight when the
// stop lands (including the held message that triggered it) must record
// its real outcome first. The in-process runner closes everything once
// its lanes have drained; a Kafka worker closes only unclaimed rows and
// each claimed row is settled by the worker holding it.
// Only this campaign stops. Other campaigns and channels keep going.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdvancedCampaignConfig } from './advanced';
import { clearCampaignWarmup } from './warmup-limiter';

/** Returns true when this call stopped it (false: already stopped / not sending). */
export async function stopCampaign(
  db: SupabaseClient,
  broadcastId: string,
  reason: string
): Promise<boolean> {
  try {
    const { data: row } = await db
      .from('broadcasts')
      .select('config')
      .eq('id', broadcastId)
      .maybeSingle();
    const config = (row?.config ?? {}) as AdvancedCampaignConfig;
    // Conditional on 'sending', so concurrent workers stop it exactly once.
    const { data, error } = await db
      .from('broadcasts')
      .update({
        status: 'failed',
        config: {
          ...config,
          stopped_reason: reason,
          stopped_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', broadcastId)
      .eq('status', 'sending')
      .select('id');
    if (error) {
      console.error(
        `[campaign] could not stop ${broadcastId}:`,
        error.message
      );
      return false;
    }
    const stopped = Array.isArray(data) && data.length > 0;
    if (!stopped) return false;

    console.warn(`[campaign] ${broadcastId} stopped — ${reason}`);
    await clearCampaignWarmup(broadcastId);
    return true;
  } catch (err) {
    console.error(
      `[campaign] stop failed for ${broadcastId}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Mark a stopped campaign's remaining pending recipients failed. No-op
 * unless the campaign carries `stopped_reason`, so it's safe to call
 * speculatively. `unclaimedOnly` leaves rows a Kafka worker is sending
 * right now (fresh `claimed_at`) for that worker to settle.
 */
export async function closeStoppedRecipients(
  db: SupabaseClient,
  broadcastId: string,
  { unclaimedOnly, claimStaleMs = 0 }: { unclaimedOnly: boolean; claimStaleMs?: number }
): Promise<void> {
  try {
    const { data: row } = await db
      .from('broadcasts')
      .select('config')
      .eq('id', broadcastId)
      .maybeSingle();
    const reason = (row?.config as AdvancedCampaignConfig | undefined)?.stopped_reason;
    if (!reason) return;

    let q = db
      .from('broadcast_recipients')
      .update({ status: 'failed', error_message: `Campaign stopped — ${reason}` })
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending');
    if (unclaimedOnly) {
      const stale = new Date(Date.now() - claimStaleMs).toISOString();
      q = q.or(`claimed_at.is.null,claimed_at.lt.${stale}`);
    }
    const { error } = await q;
    if (error) {
      console.error(
        `[campaign] ${broadcastId}: could not close pending recipients:`,
        error.message
      );
    }
  } catch (err) {
    console.error(
      `[campaign] close pending failed for ${broadcastId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
