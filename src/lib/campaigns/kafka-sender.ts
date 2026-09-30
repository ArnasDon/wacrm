// ============================================================
// Advanced campaigns over Kafka.
//
// dispatchCampaignToKafka() — queue every unclaimed pending recipient on
//   the `campaign.sends` topic, spread round-robin over the campaign's
//   channels. The message key is the channel id, so one channel's
//   recipients share a partition and are paced by one consumer.
//
// handleCampaignSend() — what a worker does with one message: claim the
//   recipient (at-least-once delivery must not mean twice-sent), send
//   with the channel's current template, fall back to the next template
//   when Meta says it's paused / disabled / gone, re-route to another
//   channel when this one has nothing left or is blocked, and settle the
//   campaign once nothing is pending.
//
// Same rules as the in-process runner (advanced-runner.ts); state that
// must be shared across workers — the exhausted templates — lives on
// broadcasts.config.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { finalizeBroadcastStatus } from '@/lib/whatsapp/broadcast-core';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { RecipientResultWriter } from '@/lib/campaigns/result-writer';
import { pauseCampaign } from '@/lib/campaigns/pause';
import {
  CampaignInboxLogger,
  campaignMessageText,
} from '@/lib/campaigns/inbox-messages';
import { CampaignSpeedLog } from './speed-log';
import {
  UNSENDABLE_TEMPLATE_STATUSES,
  resolveSendParams,
  QUALITY_HOLD_STATUS,
  ROW_CHANNEL,
  ROW_TEMPLATE,
  type AdvancedCampaignConfig,
} from '@/lib/campaigns/advanced';
import {
  currentOption,
  pickOption,
  loadChannelStates,
  senderFor,
  templateMatchesEvent,
  type ChannelState,
} from '@/lib/campaigns/advanced-runner';
import { onTemplateStatus } from '@/lib/campaigns/template-status-bus';
import {
  publishCampaignSends,
  type CampaignSendMessage,
} from '@/lib/kafka/producers';

/** A claim older than this belongs to a worker that went away. */
export const CLAIM_STALE_MS = 10 * 60 * 1000;
/** Re-queue a campaign's leftovers at most this often. */
export const REDISPATCH_AFTER_MS = 10 * 60 * 1000;
const CONTEXT_TTL_MS = 10_000;
const MAX_ATTEMPTS = 20;
const PAGE = 1000;

// ------------------------------------------------------------
// Dispatch
// ------------------------------------------------------------

export type DispatchResult =
  | { status: 'queued'; count: number }
  | { status: 'skipped' }
  | { status: 'failed_all' }
  | { status: 'publish_failed' };

export async function dispatchCampaignToKafka(
  db: SupabaseClient,
  broadcastId: string,
  { force = false }: { force?: boolean } = {}
): Promise<DispatchResult> {
  const { data: bc } = await db
    .from('broadcasts')
    .select('id, account_id, status, kind, config')
    .eq('id', broadcastId)
    .maybeSingle();
  if (!bc || bc.kind !== 'advanced' || bc.status !== 'sending' || !bc.config) {
    return { status: 'skipped' };
  }
  const config = bc.config as AdvancedCampaignConfig;
  const last = config.kafka_dispatched_at
    ? Date.parse(config.kafka_dispatched_at)
    : 0;
  if (!force && last && Date.now() - last < REDISPATCH_AFTER_MS) {
    return { status: 'skipped' };
  }

  const channels = await loadChannelStates(db, bc.account_id, config);
  const usable = channels.filter((c) => currentOption(c));
  if (usable.length === 0) {
    await failRemaining(db, broadcastId, channels);
    return { status: 'failed_all' };
  }

  const stale = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  let lastId: string | null = null;
  let count = 0;
  for (;;) {
    let q = db
      .from('broadcast_recipients')
      .select('id, row_data')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending')
      .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (lastId) q = q.gt('id', lastId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) break;

    // The planned channel (distribution) while it can send, else
    // round-robin over the usable ones.
    const usableIds = new Set(usable.map((c) => c.id));
    const messages: CampaignSendMessage[] = rows.map((r, i) => {
      const planned = (r.row_data as Record<string, string> | null)?.[
        ROW_CHANNEL
      ];
      return {
        v: 1,
        broadcastId,
        recipientId: r.id as string,
        channelId:
          planned && usableIds.has(planned)
            ? planned
            : usable[(count + i) % usable.length].id,
        attempt: 0,
      };
    });
    if (!(await publishCampaignSends(messages))) {
      return { status: 'publish_failed' };
    }
    count += rows.length;
    lastId = rows[rows.length - 1].id as string;
    if (rows.length < PAGE) break;
  }

  await mergeConfig(db, broadcastId, {
    kafka_dispatched_at: new Date().toISOString(),
  });
  if (count === 0) await finalizeBroadcastStatus(db, broadcastId);
  return { status: 'queued', count };
}

// ------------------------------------------------------------
// Worker
// ------------------------------------------------------------

interface CampaignContext {
  loadedAt: number;
  accountId: string;
  status: string;
  config: AdvancedCampaignConfig;
  channels: Map<string, ChannelState>;
}

const g = globalThis as unknown as {
  __wacrmCampaignCtx?: Map<string, CampaignContext>;
  __wacrmCampaignBus?: boolean;
  __wacrmFinalizeAt?: Map<string, number>;
};
const contexts = (g.__wacrmCampaignCtx ??= new Map());
const finalizeAt = (g.__wacrmFinalizeAt ??= new Map());

// A template paused at Meta: drop it from every cached campaign now.
if (!g.__wacrmCampaignBus) {
  g.__wacrmCampaignBus = true;
  onTemplateStatus((e) => {
    if (!UNSENDABLE_TEMPLATE_STATUSES.has(e.event)) return;
    for (const ctx of contexts.values()) {
      for (const ch of ctx.channels.values()) {
        for (const o of ch.options) {
          if (templateMatchesEvent(o.row, e) && !(o.key in ch.exhausted)) {
            ch.exhausted[o.key] = `Template ${e.event.toLowerCase()} by Meta`;
          }
        }
      }
    }
  });
}

async function loadContext(
  db: SupabaseClient,
  broadcastId: string
): Promise<CampaignContext | null> {
  const cached = contexts.get(broadcastId);
  if (cached && Date.now() - cached.loadedAt < CONTEXT_TTL_MS) return cached;

  const { data: bc } = await db
    .from('broadcasts')
    .select('account_id, status, kind, config')
    .eq('id', broadcastId)
    .maybeSingle();
  if (!bc || bc.kind !== 'advanced' || !bc.config) {
    contexts.delete(broadcastId);
    return null;
  }
  const config = bc.config as AdvancedCampaignConfig;
  let channels: Map<string, ChannelState>;
  // Same dispatch round: keep pacing state and add what other workers
  // dropped. A new round (resume / retry) starts from the DB's list.
  if (
    cached &&
    cached.config.kafka_dispatched_at === config.kafka_dispatched_at
  ) {
    channels = cached.channels;
    for (const ch of channels.values()) {
      ch.exhausted = {
        ...(config.exhausted?.[ch.id] ?? {}),
        ...ch.exhausted,
      };
    }
  } else {
    const list = await loadChannelStates(db, bc.account_id, config);
    channels = new Map(list.map((c) => [c.id, c]));
  }

  // Template statuses may have changed without an event reaching this
  // process (missed webhook, manual sync) — re-check them on refresh.
  const ids = [
    ...new Set(
      [...channels.values()].flatMap((c) => c.options.map((o) => o.row.id))
    ),
  ];
  if (ids.length) {
    const { data: statuses } = await db
      .from('message_templates')
      .select('id, status')
      .in('id', ids);
    const byId = new Map(
      (statuses ?? []).map((r) => [r.id, r.status as string])
    );
    for (const ch of channels.values()) {
      for (const o of ch.options) {
        const st = byId.get(o.row.id);
        if (
          st &&
          UNSENDABLE_TEMPLATE_STATUSES.has(st) &&
          !(o.key in ch.exhausted)
        ) {
          ch.exhausted[o.key] = `Template ${st.toLowerCase()} by Meta`;
        }
      }
    }
  }

  const ctx: CampaignContext = {
    loadedAt: Date.now(),
    accountId: bc.account_id as string,
    status: bc.status,
    config,
    channels,
  };
  contexts.set(broadcastId, ctx);
  return ctx;
}

/** Read-modify-write of broadcasts.config against the latest row. */
async function mergeConfig(
  db: SupabaseClient,
  broadcastId: string,
  patch: Partial<AdvancedCampaignConfig>
): Promise<void> {
  const { data } = await db
    .from('broadcasts')
    .select('config')
    .eq('id', broadcastId)
    .maybeSingle();
  if (!data?.config) return;
  const current = data.config as AdvancedCampaignConfig;
  const exhausted = patch.exhausted
    ? mergeExhausted(current.exhausted ?? {}, patch.exhausted)
    : current.exhausted;
  await db
    .from('broadcasts')
    .update({ config: { ...current, ...patch, exhausted } })
    .eq('id', broadcastId);
}

function mergeExhausted(
  a: Record<string, Record<string, string>>,
  b: Record<string, Record<string, string>>
) {
  const out: Record<string, Record<string, string>> = { ...a };
  for (const [ch, keys] of Object.entries(b))
    out[ch] = { ...(out[ch] ?? {}), ...keys };
  return out;
}

async function failRemaining(
  db: SupabaseClient,
  broadcastId: string,
  channels: ChannelState[]
): Promise<void> {
  const reasons = channels
    .map((ch) =>
      ch.fatal
        ? `${ch.name}: ${ch.fatal}`
        : `${ch.name}: ${Object.values(ch.exhausted).at(-1) ?? 'no approved template'}`
    )
    .join('; ');
  await db
    .from('broadcast_recipients')
    .update({
      status: 'failed',
      error_message: channels.length
        ? `No usable template left on any channel — ${reasons}`
        : 'None of the campaign channels are connected any more',
    })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');
  await finalizeBroadcastStatus(db, broadcastId);
}

/** Settle the campaign once nothing is pending (checked at most every 3 s). */
async function maybeFinalize(db: SupabaseClient, broadcastId: string) {
  const now = Date.now();
  if ((finalizeAt.get(broadcastId) ?? 0) > now) return;
  finalizeAt.set(broadcastId, now + 3000);
  const { count } = await db
    .from('broadcast_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');
  if (!count) {
    await finalizeBroadcastStatus(db, broadcastId);
    contexts.delete(broadcastId);
  }
}

const g2 = globalThis as unknown as {
  __wacrmResultWriters?: WeakMap<object, RecipientResultWriter>;
};
const writers = (g2.__wacrmResultWriters ??= new WeakMap());
const g3 = globalThis as unknown as {
  __wacrmInboxLoggers?: WeakMap<object, CampaignInboxLogger>;
};
const inboxLoggers = (g3.__wacrmInboxLoggers ??= new WeakMap());
function inboxFor(db: SupabaseClient): CampaignInboxLogger {
  let l = inboxLoggers.get(db);
  if (!l) {
    l = new CampaignInboxLogger(db);
    inboxLoggers.set(db, l);
  }
  return l;
}

/** One per-second speed log per campaign per process (speed-log.ts). */
const g4 = globalThis as unknown as {
  __wacrmSpeedLogs?: Map<string, CampaignSpeedLog>;
};
const speedLogs = (g4.__wacrmSpeedLogs ??= new Map());
function speedLogFor(
  db: SupabaseClient,
  accountId: string,
  broadcastId: string
): CampaignSpeedLog {
  let l = speedLogs.get(broadcastId);
  if (!l) {
    l = new CampaignSpeedLog(db, accountId, broadcastId, 'kafka');
    speedLogs.set(broadcastId, l);
    // Bounded: old campaigns' loggers go (they flush on their own timer).
    if (speedLogs.size > 200) {
      const oldest = speedLogs.keys().next().value as string;
      void speedLogs.get(oldest)?.flush();
      speedLogs.delete(oldest);
    }
  }
  return l;
}

/** One batched writer per DB client per process. */
function writerFor(db: SupabaseClient): RecipientResultWriter {
  let w = writers.get(db);
  if (!w) {
    w = new RecipientResultWriter(db);
    writers.set(db, w);
  }
  return w;
}

export type SendOutcome =
  'sent' | 'failed' | 'skipped' | 'rerouted' | 'deferred';

/** Process one `campaign.sends` message (see handleCampaignSendBatch). */
export async function handleCampaignSend(
  db: SupabaseClient,
  msg: CampaignSendMessage
): Promise<SendOutcome> {
  const [outcome] = await handleCampaignSendBatch(db, [msg]);
  return outcome;
}

/**
 * Process a batch of `campaign.sends` messages: claim their recipients
 * in one statement per campaign, send them concurrently (each channel's
 * ChannelSender paces and bounds them), write results in batches, and
 * flush before returning — so a committed Kafka offset always means the
 * outcome is persisted.
 *
 * Per-recipient problems never throw. Only infrastructure errors (DB
 * unreachable while claiming) propagate, and the consumer retries; the
 * claim keeps a retry from double-sending.
 */
export async function handleCampaignSendBatch(
  db: SupabaseClient,
  msgs: CampaignSendMessage[]
): Promise<SendOutcome[]> {
  const writer = writerFor(db);
  const outcomes: SendOutcome[] = new Array(msgs.length).fill('skipped');
  const byCampaign = new Map<string, number[]>();
  msgs.forEach((m, i) => {
    const list = byCampaign.get(m.broadcastId) ?? [];
    list.push(i);
    byCampaign.set(m.broadcastId, list);
  });

  for (const [broadcastId, indexes] of byCampaign) {
    const ctx = await loadContext(db, broadcastId);
    if (!ctx) continue;
    // Fresh status every batch (the cache is 10 s old at most): a pause
    // from another worker stops this one before its next batch.
    const { data: live } = await db
      .from('broadcasts')
      .select('status')
      .eq('id', broadcastId)
      .maybeSingle();
    if (live?.status) ctx.status = live.status as string;
    if (ctx.status !== 'sending') continue;

    // Claim every recipient of this batch at once.
    const ids = [...new Set(indexes.map((i) => msgs[i].recipientId))];
    const stale = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
    const { data: claimedRows, error: claimErr } = await db
      .from('broadcast_recipients')
      .update({ claimed_at: new Date().toISOString() })
      .in('id', ids)
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending')
      .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
      .select('id, contact_id, row_data, contact:contacts(phone)');
    if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);
    const claimed = new Map(
      (claimedRows ?? []).map((r) => [r.id as string, r])
    );

    await Promise.all(
      indexes.map(async (i) => {
        const msg = msgs[i];
        const row = claimed.get(msg.recipientId);
        if (!row) return; // someone else has it / already done
        claimed.delete(msg.recipientId); // a duplicate in the batch is skipped
        try {
          outcomes[i] = await processClaimed(db, writer, ctx, msg, row);
        } catch (err) {
          // Never escape: give the claim back so a re-dispatch retries it.
          console.error(
            '[kafka] campaign send crashed:',
            err instanceof Error ? err.message : err
          );
          await db
            .from('broadcast_recipients')
            .update({ claimed_at: null })
            .eq('id', msg.recipientId)
            .eq('status', 'pending');
          outcomes[i] = 'deferred';
        }
      })
    );
  }

  await writer.flush();
  void inboxFor(db).flush(); // best-effort, off the offset path
  for (const broadcastId of byCampaign.keys())
    await maybeFinalize(db, broadcastId);
  return outcomes;
}

async function processClaimed(
  db: SupabaseClient,
  writer: RecipientResultWriter,
  ctx: CampaignContext,
  msg: CampaignSendMessage,
  claimed: { row_data?: unknown; contact?: unknown; contact_id?: unknown }
): Promise<SendOutcome> {
  const release = () =>
    db
      .from('broadcast_recipients')
      .update({ claimed_at: null })
      .eq('id', msg.recipientId)
      .eq('status', 'pending');
  const reroute = async (why: string): Promise<SendOutcome> => {
    // Give the claim back before handing the recipient on.
    await db
      .from('broadcast_recipients')
      .update({ claimed_at: null })
      .eq('id', msg.recipientId)
      .eq('status', 'pending');
    const others = [...ctx.channels.values()].filter(
      (c) => c.id !== msg.channelId && currentOption(c)
    );
    const self = ctx.channels.get(msg.channelId);
    const targets = others.length
      ? others
      : self && currentOption(self)
        ? [self]
        : [];
    if (targets.length === 0 || msg.attempt >= MAX_ATTEMPTS) {
      if (targets.length === 0) {
        await writer.flush();
        await failRemaining(db, msg.broadcastId, [...ctx.channels.values()]);
      } else {
        await writer.record({
          id: msg.recipientId,
          status: 'failed',
          error_message: `Could not be sent after ${MAX_ATTEMPTS} attempts (${why})`,
        });
      }
      return 'failed';
    }
    const target = targets[(msg.attempt + 1) % targets.length];
    const ok = await publishCampaignSends([
      { ...msg, channelId: target.id, attempt: msg.attempt + 1 },
    ]);
    // Not re-queued: it stays pending and unclaimed — the next
    // re-dispatch of the campaign picks it up.
    return ok ? 'rerouted' : 'deferred';
  };

  const ch = ctx.channels.get(msg.channelId);
  if (!ch || !currentOption(ch))
    return reroute('channel has no usable template');

  const row = (claimed.row_data ?? {}) as Record<string, string>;
  const contactRaw = claimed.contact as
    { phone?: string | null } | { phone?: string | null }[] | null | undefined;
  const contact = Array.isArray(contactRaw) ? contactRaw[0] : contactRaw;
  const phone = row.__phone || sanitizePhoneForMeta(contact?.phone ?? '');
  const markFailed = async (
    text: string,
    extra: Record<string, string> = {}
  ) => {
    await writer.record({
      id: msg.recipientId,
      status: 'failed',
      error_message: text,
      ...extra,
    });
    return 'failed' as const;
  };
  if (!phone) return markFailed('No valid phone number');

  for (;;) {
    const option = pickOption(ch, row[ROW_TEMPLATE]);
    if (!option) return reroute('templates exhausted');

    let params;
    try {
      params = resolveSendParams(
        option.row,
        ctx.config.mappings[option.key],
        row
      );
    } catch (err) {
      return markFailed(
        err instanceof Error ? err.message : 'Missing variable'
      );
    }

    // Paused meanwhile (delivery settings): give the recipient back.
    if (ctx.status !== 'sending') {
      await release();
      return 'skipped';
    }

    const result = await senderFor(ch, ctx.config.speed, {
      onEvent: speedLogFor(db, ctx.accountId, msg.broadcastId).forChannel(
        ch.id
      ),
      broadcastId: msg.broadcastId,
    }).send({
      phone,
      template: option.row,
      params,
    });

    if (result.ok) {
      await writer.record({
        id: msg.recipientId,
        status: 'sent',
        // When the request left, not when Meta replied: that's the
        // moment Meta's rate limit counts, and what throughput measures.
        sent_at: new Date(result.sentAt).toISOString(),
        whatsapp_message_id: result.messageId,
        whatsapp_config_id: ch.id,
        template_name: option.row.name,
        template_language: option.row.language ?? 'en_US',
        error_message: null,
        meta_message_status: result.messageStatus ?? null,
      });
      if (claimed.contact_id) {
        inboxFor(db).record({
          accountId: ctx.accountId,
          contactId: claimed.contact_id as string,
          channelId: ch.id,
          wamid: result.messageId,
          text: campaignMessageText(option.row, params),
          templateName: option.row.name,
          sentAt: new Date(result.sentAt).toISOString(),
        });
      }
      // Held for Meta's quality check = accepted; pause only if asked.
      if (
        result.messageStatus === QUALITY_HOLD_STATUS &&
        ctx.config.delivery?.pause_on_quality_hold
      ) {
        await pauseCtx(
          ctx,
          db,
          msg.broadcastId,
          `Meta held a message for quality assessment (${ch.name})`
        );
      }
      return 'sent';
    }

    const { action, text } = result.error;
    if (action === 'template') {
      // Out for this channel (every worker, via config); try the next
      // template for the same recipient.
      ch.exhausted[option.key] = text;
      await mergeConfig(db, msg.broadcastId, {
        exhausted: { [ch.id]: { [option.key]: text } },
      });
      continue;
    }
    if (action === 'channel') {
      ch.fatal = text;
      return reroute(text);
    }
    if (action === 'throttle') return reroute(text);
    const failed = await markFailed(text, {
      whatsapp_config_id: ch.id,
      template_name: option.row.name,
      template_language: option.row.language ?? 'en_US',
    });
    // "Stop on Meta API error": pauses this campaign only.
    if (result.error.fromMeta && ctx.config.delivery?.stop_on_meta_error) {
      await pauseCtx(
        ctx,
        db,
        msg.broadcastId,
        `Meta API error on ${ch.name}: ${text}`
      );
    }
    return failed;
  }
}

/** Pause the campaign and make this worker's cached copy stop at once. */
async function pauseCtx(
  ctx: CampaignContext,
  db: SupabaseClient,
  broadcastId: string,
  reason: string
) {
  if (ctx.status !== 'sending') return;
  ctx.status = 'paused';
  await pauseCampaign(db, broadcastId, reason);
}
