// ============================================================
// Advanced campaign runner.
//
// One pass over an advanced campaign's pending recipients, server-side:
//
//   * Every selected channel sends at the same time, each with a few
//     concurrent lanes paced to the campaign's messages-per-second. The
//     channels pull from ONE shared queue, so the audience is split
//     across them and a slow or stopped channel's share is picked up by
//     the others.
//   * Each channel walks the campaign's template list in order. When
//     Meta answers that a template is paused / disabled / gone (or the
//     template-status webhook flips it to PAUSED mid-run), that channel
//     moves to the next template and the recipient that bounced is put
//     back on the queue — so the rest of the audience still goes out.
//   * A pass is time-boxed (`budgetMs`) and returns 'yielded' when time
//     runs out with work left; the scheduler starts another pass.
//
// Per-status counts stay owned by the broadcast_recipients aggregate
// trigger — only recipient rows and the terminal status are written.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { ChannelSender } from '@/lib/campaigns/channel-sender';
import { channelMaxRate } from '@/lib/campaigns/rate-limiter';
import { RecipientResultWriter } from '@/lib/campaigns/result-writer';
import { closeStoppedRecipients, stopCampaign } from '@/lib/campaigns/pause';
import {
  CampaignInboxLogger,
  campaignMessageText,
} from '@/lib/campaigns/inbox-messages';
import { CampaignSpeedLog, type SpeedEventInfo } from './speed-log';
import { warmupConfigForTier, warmupLimiter } from './warmup-limiter';
import { finalizeBroadcastStatus } from '@/lib/whatsapp/broadcast-core';
import type { MessageTemplate } from '@/types';
import { onTemplateStatus } from '@/lib/campaigns/template-status-bus';
import type { TemplateStatusEvent } from '@/lib/kafka/producers';
import {
  UNSENDABLE_TEMPLATE_STATUSES,
  resolveSendParams,
  templateKey,
  QUALITY_HOLD_STATUS,
  ROW_CHANNEL,
  ROW_TEMPLATE,
  type AdvancedCampaignConfig,
} from '@/lib/campaigns/advanced';

export type RunOutcome = 'finished' | 'yielded' | 'stopped';

export interface RunOptions {
  budgetMs: number;
  /** Override the concurrent sends per channel (default: from its rate). */
  maxLanes?: number;
}

/** Template/campaign re-check + lock heartbeat interval. */
const REFRESH_MS = 15_000;
const QUEUE_PAGE = 1000;

interface QueueItem {
  id: string;
  phone: string;
  row: Record<string, string>;
  /** Requeues after a template/rate bounce — caps a pathological loop. */
  bounces: number;
  contactId: string | null;
  /** Planned channel / template (distribution), when the campaign has one. */
  channel?: string;
  template?: string;
}

export interface TemplateOption {
  key: string;
  row: MessageTemplate;
}

export interface ChannelState {
  id: string;
  name: string;
  phoneNumberId: string;
  token: string;
  options: TemplateOption[];
  /** Keys this channel gave up on → reason. */
  exhausted: Record<string, string>;
  /** Set when the channel itself can't send (token revoked, blocked…). */
  fatal: string | null;
  /** Meta's throughput tier cap for the number: 80 or 1 000 msg/s. */
  maxRate: number;
  /** Paced sender for this channel (created on first use). */
  sender?: ChannelSender;
}

/** The channel's paced sender at min(campaign speed, the number's tier). */
export function senderFor(
  ch: ChannelState,
  speed: number,
  opts: {
    onEvent?: (e: SpeedEventInfo) => void;
    /** Enables this campaign's warm-up on the channel (warmup-limiter.ts). */
    broadcastId?: string;
  } = {}
): ChannelSender {
  ch.sender ??= new ChannelSender({
    onEvent: opts.onEvent,
    warmup: opts.broadcastId
      ? warmupLimiter(
          opts.broadcastId,
          ch.phoneNumberId,
          warmupConfigForTier(ch.maxRate)
        )
      : null,
    phoneNumberId: ch.phoneNumberId,
    accessToken: ch.token,
    rate: Math.max(1, Math.min(speed, ch.maxRate)),
    maxRate: ch.maxRate,
  });
  return ch.sender;
}

/** Does a template-status event refer to this template row? */
export function templateMatchesEvent(
  row: Pick<
    MessageTemplate,
    'meta_template_id' | 'name' | 'language' | 'waba_id'
  >,
  e: Pick<TemplateStatusEvent, 'templateId' | 'name' | 'language' | 'wabaId'>
): boolean {
  if (e.templateId && row.meta_template_id) {
    return String(row.meta_template_id) === e.templateId;
  }
  return (
    !!e.name &&
    row.name === e.name &&
    (!e.language || (row.language ?? 'en_US') === e.language) &&
    (!e.wabaId || !row.waba_id || row.waba_id === e.wabaId)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The campaign's channels, each with its usable templates in the
 * campaign's order (approved, in that channel's WABA) and what it
 * already gave up on. Shared by the in-process runner and the Kafka
 * campaign worker.
 */
export async function loadChannelStates(
  db: SupabaseClient,
  accountId: string,
  config: AdvancedCampaignConfig
): Promise<ChannelState[]> {
  const { data: channelRows } = await db
    .from('whatsapp_config')
    .select(
      'id, name, verified_name, display_phone_number, phone_number_id, waba_id, access_token, throughput_level'
    )
    .eq('account_id', accountId)
    .in('id', config.channel_ids);

  const names = [...new Set(config.templates.map((t) => t.name))];
  const { data: templateRows } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .in('name', names);
  const templates = (templateRows ?? []) as MessageTemplate[];

  const channels: ChannelState[] = [];
  for (const c of channelRows ?? []) {
    let token: string;
    try {
      token = decrypt(c.access_token);
    } catch {
      continue;
    }
    const options: TemplateOption[] = [];
    for (const ref of config.channel_templates?.[c.id] ?? config.templates) {
      const candidates = templates.filter(
        (t) => t.name === ref.name && (t.language ?? 'en_US') === ref.language
      );
      const row =
        candidates.find((t) => t.waba_id === c.waba_id) ??
        candidates.find((t) => !t.waba_id);
      if (row && row.status === 'APPROVED')
        options.push({ key: templateKey(ref), row });
    }
    channels.push({
      id: c.id,
      name:
        c.name ||
        c.verified_name ||
        c.display_phone_number ||
        c.phone_number_id,
      phoneNumberId: c.phone_number_id,
      token,
      options,
      exhausted: { ...(config.exhausted?.[c.id] ?? {}) },
      fatal: null,
      maxRate: channelMaxRate(c.throughput_level),
    });
  }
  return channels;
}

/** "[132015] Template is paused" — the shape the Analytics tab groups by. */
export function formatSendError(err: unknown): {
  code: number | null;
  text: string;
} {
  if (err instanceof MetaApiError) {
    const detail =
      err.details && !err.message.includes(err.details)
        ? `: ${err.details}`
        : '';
    return {
      code: err.code,
      text:
        err.code != null
          ? `[${err.code}] ${err.message}${detail}`
          : `${err.message}${detail}`,
    };
  }
  return {
    code: null,
    text: err instanceof Error ? err.message : 'Unknown error',
  };
}

export const currentOption = (ch: ChannelState) =>
  ch.fatal ? null : (ch.options.find((o) => !(o.key in ch.exhausted)) ?? null);

/**
 * The template to send a recipient with: its planned one while this
 * channel can still use it, else the channel's first usable template.
 */
export function pickOption(
  ch: ChannelState,
  plannedKey?: string | null
): TemplateOption | null {
  if (ch.fatal) return null;
  const planned = plannedKey
    ? ch.options.find((o) => o.key === plannedKey && !(o.key in ch.exhausted))
    : undefined;
  return planned ?? currentOption(ch);
}

export async function runAdvancedCampaign(
  db: SupabaseClient,
  broadcastId: string,
  opts: RunOptions
): Promise<RunOutcome> {
  const deadline = Date.now() + opts.budgetMs;

  const { data: broadcast } = await db
    .from('broadcasts')
    .select('id, account_id, status, kind, config')
    .eq('id', broadcastId)
    .maybeSingle();
  if (
    !broadcast ||
    broadcast.kind !== 'advanced' ||
    broadcast.status !== 'sending' ||
    !broadcast.config
  ) {
    return 'stopped';
  }
  const config = broadcast.config as AdvancedCampaignConfig;
  const accountId = broadcast.account_id as string;

  // ── Channels + templates ───────────────────────────────────────
  const channels = await loadChannelStates(db, accountId, config);

  const persistExhausted = async () => {
    const exhausted: Record<string, Record<string, string>> = {};
    for (const ch of channels)
      if (Object.keys(ch.exhausted).length) exhausted[ch.id] = ch.exhausted;
    config.exhausted = exhausted;
    // Merge onto the latest config — others write it too (pause reason,
    // start time, Kafka dispatch time); never overwrite their fields.
    const { data: latest } = await db
      .from('broadcasts')
      .select('config')
      .eq('id', broadcastId)
      .maybeSingle();
    await db
      .from('broadcasts')
      .update({ config: { ...(latest?.config ?? config), exhausted } })
      .eq('id', broadcastId);
  };

  const exhaust = (ch: ChannelState, key: string, reason: string) => {
    if (key in ch.exhausted) return;
    ch.exhausted[key] = reason;
    console.warn(
      `[advanced-campaign] ${broadcastId}: channel ${ch.name} dropped template ${key} — ${reason}`
    );
    void persistExhausted();
  };

  // ── Shared queue ───────────────────────────────────────────────
  // `queue` holds unplanned / re-routed recipients any channel may take;
  // `own` holds each channel's planned share (distribution), which only
  // that channel sends — until it can't, then the share moves to `queue`.
  const queue: QueueItem[] = [];
  const own = new Map<string, QueueItem[]>();
  const byId = new Map(channels.map((c) => [c.id, c]));
  const queued = () =>
    queue.length + [...own.values()].reduce((n, l) => n + l.length, 0);
  const putBack = (ch: ChannelState, item: QueueItem, front = true) => {
    const list = currentOption(ch) ? (own.get(ch.id) ?? []) : queue;
    if (list !== queue) own.set(ch.id, list);
    if (front) list.unshift(item);
    else list.push(item);
  };
  const taken = new Set<string>();
  let drained = false;
  let refilling: Promise<void> | null = null;

  // Pages continue after the last row read (created_at, id), not from
  // the top: rows already taken are still 'pending' until their result is
  // written, and with thousands in flight a first page could be nothing
  // but those — which would read as "no work left".
  let cursor: { at: string; id: string } | null = null;
  const refill = () => {
    refilling ??= (async () => {
      let q = db
        .from('broadcast_recipients')
        .select('id, created_at, contact_id, row_data, contact:contacts(phone)')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending');
      if (cursor) {
        q = q.or(
          `created_at.gt."${cursor.at}",and(created_at.eq."${cursor.at}",id.gt.${cursor.id})`
        );
      }
      const { data, error } = await q
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(QUEUE_PAGE);
      // A failed read isn't "no work left": try again on the next call.
      if (error) {
        console.error(
          `[advanced-campaign] ${broadcastId}: loading recipients failed:`,
          error.message
        );
        await sleep(1000);
        return;
      }
      const last = data?.at(-1);
      if (last) cursor = { at: last.created_at as string, id: last.id };
      let added = 0;
      for (const r of data ?? []) {
        if (taken.has(r.id)) continue;
        taken.add(r.id);
        const row = (r.row_data ?? {}) as Record<string, string>;
        const contact = Array.isArray(r.contact) ? r.contact[0] : r.contact;
        const phone = row.__phone || sanitizePhoneForMeta(contact?.phone ?? '');
        const item: QueueItem = {
          id: r.id,
          phone,
          row,
          bounces: 0,
          contactId: (r.contact_id as string | null) ?? null,
          channel: row[ROW_CHANNEL] || undefined,
          template: row[ROW_TEMPLATE] || undefined,
        };
        const owner = item.channel ? byId.get(item.channel) : undefined;
        if (owner && currentOption(owner)) {
          const list = own.get(owner.id) ?? [];
          list.push(item);
          own.set(owner.id, list);
        } else queue.push(item);
        added++;
      }
      if (added === 0) drained = true;
    })().finally(() => {
      refilling = null;
    });
    return refilling;
  };

  // Items handed to a lane and not yet settled. While any are out, an
  // empty queue isn't the end — a bounced one may come back for another
  // channel (or template) to send.
  let inFlight = 0;
  const next = async (ch: ChannelState): Promise<QueueItem | null> => {
    for (;;) {
      // Load the next page in the background before the queue runs dry,
      // so lanes never stop sending to wait for the database.
      if (!drained && !refilling && queued() < QUEUE_PAGE / 2) void refill();
      const mine = own.get(ch.id);
      if (mine?.length) return mine.shift()!;
      if (queue.length > 0) return queue.shift()!;
      if (!drained) {
        if (stopped || Date.now() >= deadline) return null;
        await refill();
        continue;
      }
      // A channel that can't send any more hands its planned share over.
      let moved = false;
      for (const [id, list] of own) {
        const c = byId.get(id);
        if (list.length && (!c || !currentOption(c))) {
          queue.push(...list.splice(0));
          moved = true;
        }
      }
      if (moved) continue;
      if (inFlight === 0 || stopped || Date.now() >= deadline) return null;
      await sleep(50);
    }
  };

  // ── Periodic refresh: template pauses from the webhook, a stopped
  // or deleted campaign, and the lock heartbeat. ──────────────────
  let stopped = false;
  let lastRefresh = Date.now();
  let refreshing: Promise<void> | null = null;
  const refresh = () => {
    refreshing ??= (async () => {
      lastRefresh = Date.now();
      const { data: bc } = await db
        .from('broadcasts')
        .update({ delivery_locked_at: new Date().toISOString() })
        .eq('id', broadcastId)
        .select('status')
        .maybeSingle();
      if (!bc || bc.status !== 'sending') {
        stopped = true;
        return;
      }
      const ids = [
        ...new Set(channels.flatMap((c) => c.options.map((o) => o.row.id))),
      ];
      if (ids.length === 0) return;
      const { data: statuses } = await db
        .from('message_templates')
        .select('id, status')
        .in('id', ids);
      const byId = new Map(
        (statuses ?? []).map((s) => [s.id, s.status as string])
      );
      for (const ch of channels) {
        for (const o of ch.options) {
          const status = byId.get(o.row.id);
          if (status && UNSENDABLE_TEMPLATE_STATUSES.has(status))
            exhaust(ch, o.key, `Template ${status.toLowerCase()} by Meta`);
        }
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  // Stop this campaign for good (delivery settings) and end this pass:
  // lanes stop taking recipients; once they drain and results are
  // flushed, everything still pending is closed as failed (below).
  let stoppedBySetting = false;
  const stopFor = async (reason: string) => {
    if (stopped) return;
    stopped = true;
    stoppedBySetting = await stopCampaign(db, broadcastId, reason);
  };

  // ── Send one recipient on one channel ──────────────────────────
  // Results are written in batches (result-writer); flushed before
  // anything reads them back.
  const writer = new RecipientResultWriter(db);
  const inbox = new CampaignInboxLogger(db);
  // Per-second sent / accepted / throttled / failed, per channel.
  const speedLog = new CampaignSpeedLog(db, accountId, broadcastId);
  const sendFor = (ch: ChannelState) =>
    senderFor(ch, config.speed, {
      onEvent: speedLog.forChannel(ch.id),
      broadcastId,
    });
  const markFailed = (
    id: string,
    text: string,
    extra: Record<string, string> = {}
  ) => writer.record({ id, status: 'failed', error_message: text, ...extra });

  const lane = async (ch: ChannelState) => {
    while (!stopped && Date.now() < deadline) {
      if (Date.now() - lastRefresh > REFRESH_MS) await refresh();
      if (!currentOption(ch) || stopped) return;
      // Slot first, then work: a channel only takes recipients as fast as
      // it can actually send them, so the queue splits by real speed.
      const sender = sendFor(ch);
      await sender.reserve();
      const item = await next(ch);
      if (!item) {
        sender.cancel();
        return;
      }
      // The channel may have lost its last template while this lane waited.
      const option = pickOption(ch, item.template);
      if (!option || stopped) {
        sender.cancel();
        putBack(ch, item);
        return;
      }
      inFlight++;
      try {
        await send(ch, option, item);
      } catch (err) {
        // Never let one recipient take the pass down: log, put it back,
        // breathe, carry on.
        console.error(
          `[advanced-campaign] ${broadcastId}: send crashed:`,
          err instanceof Error ? err.message : err
        );
        item.bounces++;
        if (item.bounces < 25) putBack(ch, item, false);
        await sleep(500);
      } finally {
        inFlight--;
      }
    }
  };

  const send = async (
    ch: ChannelState,
    option: TemplateOption,
    item: QueueItem
  ) => {
    const sender = sendFor(ch);
    if (!item.phone) {
      sender.cancel();
      await markFailed(item.id, 'No valid phone number');
      return;
    }

    let params;
    try {
      params = resolveSendParams(
        option.row,
        config.mappings[option.key],
        item.row
      );
    } catch (err) {
      sender.cancel();
      await markFailed(
        item.id,
        err instanceof Error ? err.message : 'Missing variable'
      );
      return;
    }

    // The lane reserved this send's slot before taking the recipient.
    const result = await sender.send(
      { phone: item.phone, template: option.row, params },
      { reserved: true }
    );

    if (result.ok) {
      await writer.record({
        id: item.id,
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
      if (item.contactId) {
        inbox.record({
          accountId,
          contactId: item.contactId,
          channelId: ch.id,
          wamid: result.messageId,
          text: campaignMessageText(option.row, params),
          templateName: option.row.name,
          sentAt: new Date(result.sentAt).toISOString(),
        });
      }
      // Accepted, but held for Meta's quality check: a success — the
      // webhook reports the outcome. Pauses the campaign only if asked.
      if (
        result.messageStatus === QUALITY_HOLD_STATUS &&
        config.delivery?.pause_on_quality_hold
      ) {
        await stopFor(
          `Meta held a message for quality assessment (${ch.name})`
        );
      }
      return;
    }

    const { action, text } = result.error;
    // Back to this channel if it can still send (next template), else to
    // the shared queue for the other channels.
    const requeue = () => {
      item.bounces++;
      putBack(ch, item);
    };

    if (item.bounces < 25 && action === 'template') {
      exhaust(ch, option.key, text);
      requeue();
    } else if (item.bounces < 25 && action === 'channel') {
      ch.fatal = text;
      console.warn(
        `[advanced-campaign] ${broadcastId}: channel ${ch.name} stopped — ${text}`
      );
      requeue();
    } else if (item.bounces < 25 && action === 'throttle') {
      // Still throttled after the sender's own retries: try later
      // (possibly on another channel).
      item.bounces++;
      putBack(ch, item, false);
    } else {
      await markFailed(item.id, text, {
        whatsapp_config_id: ch.id,
        template_name: option.row.name,
        template_language: option.row.language ?? 'en_US',
      });
      // "Stop on Meta API error": a real Meta error (not our validation,
      // not an ambiguous timeout) pauses this campaign only.
      if (result.error.fromMeta && config.delivery?.stop_on_meta_error) {
        await stopFor(`Meta API error on ${ch.name}: ${text}`);
      }
    }
  };

  // Enough concurrent lanes per channel to reach its rate at Graph API
  // latency (the sender's semaphore is the hard cap).
  const lanesFor = (ch: ChannelState) =>
    Math.max(1, opts.maxLanes ?? sendFor(ch).maxInFlight);
  // Meta paused / disabled a template mid-run (template-status-bus):
  // drop it on the channels using it right away.
  const unsubscribe = onTemplateStatus((e) => {
    if (!UNSENDABLE_TEMPLATE_STATUSES.has(e.event)) return;
    for (const ch of channels) {
      for (const o of ch.options) {
        if (templateMatchesEvent(o.row, e)) {
          exhaust(ch, o.key, `Template ${e.event.toLowerCase()} by Meta`);
        }
      }
    }
  });

  await refresh();
  try {
    if (!stopped) {
      await Promise.all(
        channels.flatMap((ch) =>
          Array.from({ length: lanesFor(ch) }, () => lane(ch))
        )
      );
    }
  } finally {
    unsubscribe();
    await writer.flush();
    await inbox.flush();
    await speedLog.flush();
  }
  await persistExhausted();

  if (stopped) {
    if (stoppedBySetting) {
      // In-flight sends are recorded (flushed above); nobody else sends
      // for this campaign while we hold its lock — close the rest.
      await closeStoppedRecipients(db, broadcastId, { unclaimedOnly: false });
      await finalizeBroadcastStatus(db, broadcastId);
    }
    return 'stopped';
  }

  // Nothing queued, nothing pending in the DB → done.
  if (queued() === 0) {
    if (!drained) await refill();
    if (queued() === 0 && drained) {
      await finalizeBroadcastStatus(db, broadcastId);
      return 'finished';
    }
  }

  // Work left: out of time (another pass continues), or every channel
  // has run out of usable templates / stopped.
  const anyUsable = channels.some((ch) => currentOption(ch));
  if (anyUsable) return 'yielded';

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
  return 'finished';
}
