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

import { MetaApiError, sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  phoneVariants,
  isRecipientNotAllowedError,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';
import { finalizeBroadcastStatus } from '@/lib/whatsapp/broadcast-core';
import type { MessageTemplate } from '@/types';
import {
  CHANNEL_FATAL_CODES,
  UNSENDABLE_TEMPLATE_STATUSES,
  isTemplateUnavailable,
  resolveSendParams,
  templateKey,
  type AdvancedCampaignConfig,
} from '@/lib/campaigns/advanced';

export type RunOutcome = 'finished' | 'yielded' | 'stopped';

export interface RunOptions {
  budgetMs: number;
  /** Max concurrent in-flight sends per channel. */
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
}

interface TemplateOption {
  key: string;
  row: MessageTemplate;
}

interface ChannelState {
  id: string;
  name: string;
  phoneNumberId: string;
  token: string;
  options: TemplateOption[];
  /** Keys this channel gave up on → reason. */
  exhausted: Record<string, string>;
  /** Set when the channel itself can't send (token revoked, blocked…). */
  fatal: string | null;
  nextSlot: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const currentOption = (ch: ChannelState) =>
  ch.fatal ? null : (ch.options.find((o) => !(o.key in ch.exhausted)) ?? null);

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
  const { data: channelRows } = await db
    .from('whatsapp_config')
    .select(
      'id, name, verified_name, display_phone_number, phone_number_id, waba_id, access_token'
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
    for (const ref of config.templates) {
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
      nextSlot: 0,
    });
  }

  const persistExhausted = async () => {
    const exhausted: Record<string, Record<string, string>> = {};
    for (const ch of channels)
      if (Object.keys(ch.exhausted).length) exhausted[ch.id] = ch.exhausted;
    config.exhausted = exhausted;
    await db.from('broadcasts').update({ config }).eq('id', broadcastId);
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
  const queue: QueueItem[] = [];
  const taken = new Set<string>();
  let drained = false;
  let refilling: Promise<void> | null = null;

  const refill = () => {
    refilling ??= (async () => {
      const { data } = await db
        .from('broadcast_recipients')
        .select('id, row_data, contact:contacts(phone)')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(QUEUE_PAGE);
      let added = 0;
      for (const r of data ?? []) {
        if (taken.has(r.id)) continue;
        taken.add(r.id);
        const row = (r.row_data ?? {}) as Record<string, string>;
        const contact = Array.isArray(r.contact) ? r.contact[0] : r.contact;
        const phone = row.__phone || sanitizePhoneForMeta(contact?.phone ?? '');
        queue.push({ id: r.id, phone, row, bounces: 0 });
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
  const next = async (): Promise<QueueItem | null> => {
    for (;;) {
      if (queue.length > 0) return queue.shift()!;
      if (!drained) {
        await refill();
        continue;
      }
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

  // ── Send one recipient on one channel ──────────────────────────
  const pace = async (ch: ChannelState) => {
    const gap = 1000 / Math.max(1, config.speed);
    const now = Date.now();
    const slot = Math.max(now, ch.nextSlot);
    ch.nextSlot = slot + gap;
    if (slot > now) await sleep(slot - now);
  };

  const markFailed = (
    id: string,
    text: string,
    extra: Record<string, string> = {}
  ) =>
    db
      .from('broadcast_recipients')
      .update({ status: 'failed', error_message: text, ...extra })
      .eq('id', id);

  const lane = async (ch: ChannelState) => {
    while (!stopped && Date.now() < deadline) {
      if (Date.now() - lastRefresh > REFRESH_MS) await refresh();
      if (!currentOption(ch) || stopped) return;
      const item = await next();
      if (!item) return;
      // The channel may have lost its last template while this lane waited.
      const option = currentOption(ch);
      if (!option) {
        queue.unshift(item);
        return;
      }
      inFlight++;
      try {
        await send(ch, option, item);
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
    if (!item.phone) {
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
      await markFailed(
        item.id,
        err instanceof Error ? err.message : 'Missing variable'
      );
      return;
    }

    await pace(ch);
    let messageId: string | null = null;
    let failure: unknown = null;
    for (const variant of phoneVariants(item.phone)) {
      try {
        const res = await sendTemplateMessage({
          phoneNumberId: ch.phoneNumberId,
          accessToken: ch.token,
          to: variant,
          templateName: option.row.name,
          language: option.row.language ?? 'en_US',
          template: option.row,
          messageParams: params,
        });
        messageId = res.messageId;
        failure = null;
        break;
      } catch (err) {
        failure = err;
        if (
          !isRecipientNotAllowedError(err instanceof Error ? err.message : '')
        )
          break;
      }
    }

    if (messageId) {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: messageId,
          whatsapp_config_id: ch.id,
          template_name: option.row.name,
          template_language: option.row.language ?? 'en_US',
          error_message: null,
        })
        .eq('id', item.id);
      return;
    }

    const { code, text } = formatSendError(failure);
    const message = failure instanceof Error ? failure.message : '';
    const requeue = () => {
      item.bounces++;
      queue.unshift(item);
    };

    if (item.bounces < 25 && isTemplateUnavailable(code, message)) {
      exhaust(ch, option.key, text);
      requeue();
    } else if (
      item.bounces < 25 &&
      code != null &&
      CHANNEL_FATAL_CODES.has(code)
    ) {
      ch.fatal = text;
      console.warn(
        `[advanced-campaign] ${broadcastId}: channel ${ch.name} stopped — ${text}`
      );
      requeue();
    } else if (item.bounces < 25 && (code === 130429 || code === 80007)) {
      // Throughput / rate limit: back this channel off and retry.
      ch.nextSlot = Date.now() + 2000;
      requeue();
    } else {
      await markFailed(item.id, text, {
        whatsapp_config_id: ch.id,
        template_name: option.row.name,
        template_language: option.row.language ?? 'en_US',
      });
    }
  };

  const lanesPer = Math.max(
    1,
    Math.min(opts.maxLanes ?? 8, Math.ceil(config.speed))
  );
  await refresh();
  if (!stopped) {
    await Promise.all(
      channels.flatMap((ch) => Array.from({ length: lanesPer }, () => lane(ch)))
    );
  }
  await persistExhausted();

  if (stopped) return 'stopped';

  // Nothing queued, nothing pending in the DB → done.
  if (queue.length === 0) {
    if (!drained) await refill();
    if (queue.length === 0 && drained) {
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
