// Pausing a campaign from inside a sender (delivery settings "Pause on
// quality hold" / "Stop on Meta API error").
//
// Only the one campaign stops: its status goes 'sending' → 'paused', so
// the in-process runner's lanes stop taking work, Kafka workers skip its
// queued messages (they stay pending, unclaimed) and the scheduler never
// picks it up again. Other campaigns and channels keep going. "Resume"
// on the campaign page puts it back to 'sending'.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdvancedCampaignConfig } from './advanced';
import { clearCampaignWarmup } from './warmup-limiter';

/** Returns true when this call paused it (false: already paused / not sending). */
export async function pauseCampaign(
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
    const { data, error } = await db
      .from('broadcasts')
      .update({
        status: 'paused',
        config: { ...config, paused_reason: reason },
        updated_at: new Date().toISOString(),
      })
      .eq('id', broadcastId)
      .eq('status', 'sending')
      .select('id');
    if (error) {
      // e.g. migration 053 (the 'paused' status) not applied yet.
      console.error(
        `[campaign] could not pause ${broadcastId}:`,
        error.message
      );
      return false;
    }
    const paused = Array.isArray(data) && data.length > 0;
    if (paused) {
      console.warn(`[campaign] ${broadcastId} paused — ${reason}`);
      // Stop its rate state too; a resume warms up again from the start.
      await clearCampaignWarmup(broadcastId);
    }
    return paused;
  } catch (err) {
    console.error(
      `[campaign] pause failed for ${broadcastId}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
