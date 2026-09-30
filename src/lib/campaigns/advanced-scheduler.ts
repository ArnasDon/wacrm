// ============================================================
// Advanced campaign scheduling.
//
// Who starts a runner pass (advanced-runner.ts):
//
//   * the create / resume routes, in `after()`, for "send now";
//   * `tickAdvancedCampaigns()` — flips due 'scheduled' campaigns to
//     'sending' and picks up any 'sending' campaign whose runner went
//     away (lock heartbeat older than LOCK_STALE_MS) or yielded. It is
//     called every 30 s in-process on a Node server (instrumentation.ts)
//     and by GET /api/campaigns/tick for serverless hosts' cron.
//
// Every pass holds `broadcasts.delivery_locked_at` (claimed with one
// conditional UPDATE), so however many ticks overlap, a campaign has at
// most one runner — while different campaigns run concurrently.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runAdvancedCampaign,
  type RunOutcome,
} from '@/lib/campaigns/advanced-runner';
import { LOCK_STALE_MS } from '@/lib/campaigns/advanced';
import { dispatchCampaignToKafka } from '@/lib/campaigns/kafka-sender';
import { claimCampaignStart } from '@/lib/campaigns/start-gate';
import { refreshCampaignThroughput } from '@/lib/campaigns/throughput-level';
import { kafkaEnabled } from '@/lib/kafka/config';
import {
  BroadcastError,
  deliverBroadcast,
  finalizeBroadcastStatus,
} from '@/lib/whatsapp/broadcast-core';
import {
  claimBroadcastDelivery,
  planBroadcastResume,
  releaseBroadcastDelivery,
} from '@/lib/whatsapp/broadcast-resume';

/**
 * How long one pass may run. Serverless functions are cut off at
 * `maxDuration` (300 s on the routes that start passes); a Node server
 * has no such limit, but bounded passes still let a restart recover.
 */
export function passBudgetMs(): number {
  const fromEnv = Number(process.env.CAMPAIGN_PASS_BUDGET_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return process.env.VERCEL ? 240_000 : 20 * 60_000;
}

export async function claimCampaignRun(
  db: SupabaseClient,
  broadcastId: string,
  now = new Date()
): Promise<boolean> {
  const stale = new Date(now.getTime() - LOCK_STALE_MS).toISOString();
  const { data, error } = await db
    .from('broadcasts')
    .update({ delivery_locked_at: now.toISOString() })
    .eq('id', broadcastId)
    .eq('kind', 'advanced')
    .eq('status', 'sending')
    .or(`delivery_locked_at.is.null,delivery_locked_at.lt.${stale}`)
    .select('id');
  if (error) {
    console.error('[advanced-campaign] claim failed:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Claim, run one pass, release. Null when another runner holds it. */
export async function driveCampaign(
  db: SupabaseClient,
  broadcastId: string
): Promise<RunOutcome | null> {
  if (!(await claimCampaignRun(db, broadcastId))) return null;
  try {
    // Campaign interval (delivery settings): wait for this campaign's
    // turn to start; still gated at the end of the pass → yield.
    const deadline = Date.now() + passBudgetMs();
    if (!(await claimCampaignStart(db, broadcastId, deadline)))
      return 'yielded';

    // Send at each number's current Meta tier (80 or 1 000 msg/s).
    const { data: bc } = await db
      .from('broadcasts')
      .select('account_id, config')
      .eq('id', broadcastId)
      .maybeSingle();
    if (bc?.account_id) {
      await refreshCampaignThroughput(
        db,
        bc.account_id as string,
        ((bc.config as { channel_ids?: string[] } | null)?.channel_ids ??
          []) as string[]
      );
    }

    // Kafka configured: queue the recipients for the worker fleet. Falls
    // back to sending in-process if the cluster can't be reached.
    if (kafkaEnabled()) {
      const res = await dispatchCampaignToKafka(db, broadcastId);
      if (res.status !== 'publish_failed') {
        return res.status === 'failed_all' ? 'finished' : 'yielded';
      }
      console.warn(
        `[advanced-campaign] ${broadcastId}: Kafka unavailable, sending in-process`
      );
    }
    return await runAdvancedCampaign(db, broadcastId, {
      budgetMs: passBudgetMs(),
    });
  } catch (err) {
    console.error(
      '[advanced-campaign] pass threw:',
      err instanceof Error ? err.message : err
    );
    return 'yielded';
  } finally {
    await db
      .from('broadcasts')
      .update({ delivery_locked_at: null })
      .eq('id', broadcastId);
  }
}

/**
 * A scheduled STANDARD campaign at its time: its recipients (params
 * frozen when it was scheduled) go out server-side through the same
 * resume machinery the "Resume" button uses, in capped passes until
 * none are pending or the pass budget runs out.
 */
export async function driveStandardCampaign(
  db: SupabaseClient,
  broadcastId: string
): Promise<void> {
  const { data: bc } = await db
    .from('broadcasts')
    .select('account_id')
    .eq('id', broadcastId)
    .maybeSingle();
  if (!bc) return;
  const accountId = bc.account_id as string;
  if (!(await claimBroadcastDelivery(db, accountId, broadcastId))) return;
  const deadline = Date.now() + passBudgetMs();
  try {
    while (Date.now() < deadline) {
      let planned;
      try {
        planned = await planBroadcastResume(
          db,
          accountId,
          broadcastId,
          'pending'
        );
      } catch (err) {
        if (err instanceof BroadcastError && err.code === 'nothing_to_resume')
          break;
        throw err;
      }
      await deliverBroadcast(db, planned.plan);
      if (planned.remaining === 0) break;
    }
  } catch (err) {
    console.error(
      '[scheduled-campaign] send failed:',
      err instanceof Error ? err.message : err
    );
  } finally {
    await finalizeBroadcastStatus(db, broadcastId).catch(() => {});
    await releaseBroadcastDelivery(db, broadcastId);
  }
}

/**
 * Start due scheduled campaigns and resume idle sending ones. Returns
 * the ids that got a pass; the passes themselves run concurrently and
 * `wait` decides whether to await them (a route in `after()` does).
 */
export async function tickAdvancedCampaigns(
  db: SupabaseClient,
  { wait = true }: { wait?: boolean } = {}
): Promise<string[]> {
  const nowIso = new Date().toISOString();

  // Scheduled → sending, one conditional UPDATE so two ticks can't both
  // flip (and both run) the same campaign.
  await db
    .from('broadcasts')
    .update({ status: 'sending', updated_at: nowIso })
    .eq('kind', 'advanced')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso);

  // Due standard campaigns: flipped and sent here (they don't run in a
  // browser tab once scheduled).
  const { data: dueStandard } = await db
    .from('broadcasts')
    .update({ status: 'sending', updated_at: nowIso })
    .eq('kind', 'standard')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .select('id');
  const standardIds = (dueStandard ?? []).map((r) => r.id as string);

  const stale = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data: idle } = await db
    .from('broadcasts')
    .select('id')
    .eq('kind', 'advanced')
    .eq('status', 'sending')
    .or(`delivery_locked_at.is.null,delivery_locked_at.lt.${stale}`)
    .limit(50);

  const ids = (idle ?? []).map((r) => r.id as string);
  const passes = Promise.all([
    ...ids.map((id) => driveCampaign(db, id)),
    ...standardIds.map((id) => driveStandardCampaign(db, id)),
  ]);
  if (wait) await passes;
  else passes.catch(() => {});
  return [...ids, ...standardIds];
}
