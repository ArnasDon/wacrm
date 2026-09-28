// In-process scheduler for long-running Node servers — see
// src/instrumentation.ts. Ticks every 30 s; the passes a tick starts run
// in the background, and the run lock keeps a campaign from being picked
// up again while its pass is alive.

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { tickAdvancedCampaigns } from '@/lib/campaigns/advanced-scheduler';

const TICK_MS = 30_000;

const globalForScheduler = globalThis as unknown as {
  __campaignScheduler?: ReturnType<typeof setInterval>;
};

export function startCampaignScheduler() {
  // Dev HMR can re-run register(); keep a single interval per process.
  if (globalForScheduler.__campaignScheduler) return;
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await tickAdvancedCampaigns(supabaseAdmin(), { wait: false });
    } catch (err) {
      console.error(
        '[campaign-scheduler] tick failed:',
        err instanceof Error ? err.message : err
      );
    } finally {
      ticking = false;
    }
  };
  globalForScheduler.__campaignScheduler = setInterval(tick, TICK_MS);
  setTimeout(tick, 5_000);
}
