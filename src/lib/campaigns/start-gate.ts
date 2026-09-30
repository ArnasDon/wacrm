// "Campaign interval" (delivery settings): a campaign with the interval
// on starts at least N seconds after the previous campaign of the
// account STARTED. The first one starts at once.
//
// The gate is a row per account in campaign_start_gates, claimed by the
// claim_campaign_start() SQL function in one conditional upsert — so it
// holds across any number of workers and restarts. The in-process wait
// below only shortens the gap; if this process dies while waiting, the
// campaign is still 'sending' and not started, and the scheduler's next
// tick claims it again. Every campaign start is recorded (interval on or
// off), so "the previous campaign" is whichever started last.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdvancedCampaignConfig } from './advanced';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Claim this campaign's start. Resolves true once it may send (already
 * started earlier, gate passed, or no gate), false if still gated when
 * `deadline` arrives (the caller yields; a later pass retries).
 */
export async function claimCampaignStart(
  db: SupabaseClient,
  broadcastId: string,
  deadline: number
): Promise<boolean> {
  const { data: bc } = await db
    .from('broadcasts')
    .select('account_id, config')
    .eq('id', broadcastId)
    .maybeSingle();
  if (!bc) return false;
  const config = (bc.config ?? {}) as AdvancedCampaignConfig;
  if (config.started_at) return true; // a later pass of a started campaign

  const interval = Math.max(
    0,
    Math.floor(config.delivery?.interval_seconds ?? 0)
  );
  for (;;) {
    const { data: wait, error } = await db.rpc('claim_campaign_start', {
      p_account_id: bc.account_id,
      p_interval_seconds: interval,
      p_enforce: interval > 0,
    });
    if (error) {
      // Migration 053 not applied: no gate rather than no sending.
      console.error(
        '[campaign] start gate unavailable, starting now:',
        error.message
      );
      break;
    }
    const seconds = Number(wait) || 0;
    if (seconds <= 0) break;
    if (Date.now() + seconds * 1000 > deadline) return false;
    // Wait in short steps, keeping the run lock fresh so no other worker
    // takes this campaign over while it waits its turn.
    await sleep(Math.min(Math.ceil(seconds * 1000) + 50, 15_000));
    await db
      .from('broadcasts')
      .update({ delivery_locked_at: new Date().toISOString() })
      .eq('id', broadcastId);
  }

  // Record the start on the campaign (merge onto the latest config).
  const { data: latest } = await db
    .from('broadcasts')
    .select('config')
    .eq('id', broadcastId)
    .maybeSingle();
  await db
    .from('broadcasts')
    .update({
      config: {
        ...(latest?.config ?? config),
        started_at: new Date().toISOString(),
      },
    })
    .eq('id', broadcastId);
  return true;
}
