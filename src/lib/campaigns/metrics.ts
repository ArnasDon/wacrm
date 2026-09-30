// ============================================================
// Campaign metrics — derived only from what the app records per
// recipient (status + sent/delivered/read/replied timestamps + the
// "[code] title: details" failure reason the webhook writes). No
// estimates: a figure the data can't support is returned as null.
// ============================================================

import type { BroadcastRecipient } from '@/types';

export type EventKind = 'sent' | 'delivered' | 'read' | 'replied' | 'failed';

export interface CampaignEvent {
  at: number;
  kind: EventKind;
  recipient: BroadcastRecipient;
}

const ts = (iso?: string | null) => (iso ? new Date(iso).getTime() : NaN);

/**
 * Every timestamped event, newest first. A failed recipient has no
 * failure timestamp of its own; its sent time (Meta refused after
 * accepting) or row creation stands in.
 */
export function campaignEvents(
  recipients: BroadcastRecipient[]
): CampaignEvent[] {
  const out: CampaignEvent[] = [];
  for (const r of recipients) {
    const push = (kind: EventKind, at: number) => {
      if (Number.isFinite(at)) out.push({ at, kind, recipient: r });
    };
    push('sent', ts(r.sent_at));
    push('delivered', ts(r.delivered_at));
    push('read', ts(r.read_at));
    push('replied', ts(r.replied_at));
    if (r.status === 'failed')
      push(
        'failed',
        Number.isFinite(ts(r.sent_at)) ? ts(r.sent_at) : ts(r.created_at)
      );
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Messages sent per second over the last `windowMs` (live campaigns). */
export function currentThroughput(
  recipients: BroadcastRecipient[],
  now: number,
  windowMs = 60_000
): number {
  const since = now - windowMs;
  let n = 0;
  for (const r of recipients) {
    const at = ts(r.sent_at);
    if (at >= since && at <= now) n++;
  }
  return n / (windowMs / 1000);
}

/** Average send rate from first to last send; null with < 2 sends. */
export function averageThroughput(
  recipients: BroadcastRecipient[]
): number | null {
  const times = recipients.map((r) => ts(r.sent_at)).filter(Number.isFinite);
  if (times.length < 2) return null;
  const span = (Math.max(...times) - Math.min(...times)) / 1000;
  return span > 0 ? times.length / span : null;
}

/** Seconds left at `perSecond`; null when nothing is moving. */
export function etaSeconds(pending: number, perSecond: number): number | null {
  if (pending <= 0) return 0;
  return perSecond > 0 ? Math.ceil(pending / perSecond) : null;
}

export interface FailureReason {
  code: number | null;
  title: string;
  count: number;
}

/** "[131049] This message was not delivered…: details" → code + title. */
export function parseFailure(message: string | null | undefined): {
  code: number | null;
  title: string;
} {
  const text = (message ?? '').trim();
  const m = /^\[(\d+)\]\s*([^:]+?)(?::\s[\s\S]*)?$/.exec(text);
  if (m) return { code: Number(m[1]), title: m[2].trim() };
  return { code: null, title: text || 'Unknown error' };
}

/** Failed recipients grouped by Meta error code, largest first. */
export function failureReasons(
  recipients: BroadcastRecipient[]
): FailureReason[] {
  const groups = new Map<string, FailureReason>();
  for (const r of recipients) {
    if (r.status !== 'failed') continue;
    const { code, title } = parseFailure(r.error_message);
    const key = code != null ? String(code) : title;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { code, title, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export interface TimelinePoint {
  at: number;
  sent: number;
  delivered: number;
  read: number;
}

/**
 * Cumulative sent / delivered / read over the campaign's active span,
 * in `buckets` equal steps. Empty when nothing has been sent.
 */
export function processingTimeline(
  recipients: BroadcastRecipient[],
  buckets = 24
): TimelinePoint[] {
  const sent = recipients
    .map((r) => ts(r.sent_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (sent.length === 0) return [];
  const delivered = recipients
    .map((r) => ts(r.delivered_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const read = recipients
    .map((r) => ts(r.read_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const start = sent[0];
  const end = Math.max(
    sent[sent.length - 1],
    delivered.at(-1) ?? 0,
    read.at(-1) ?? 0,
    start + 60_000
  );
  const step = (end - start) / buckets;
  const countUpTo = (list: number[], t: number) => {
    // list is sorted — binary search for the first value > t.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const points: TimelinePoint[] = [];
  for (let i = 0; i <= buckets; i++) {
    const t = start + step * i;
    points.push({
      at: t,
      sent: countUpTo(sent, t),
      delivered: countUpTo(delivered, t),
      read: countUpTo(read, t),
    });
  }
  return points;
}

/** Replies per calendar day (local time) for the last `days` days. */
export function replyTrend(
  recipients: BroadcastRecipient[],
  now: number,
  days = 8
): { day: number; replies: number }[] {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOfDay(now);
  const out = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    return { day: d.getTime(), replies: 0 };
  });
  for (const r of recipients) {
    const at = ts(r.replied_at);
    if (!Number.isFinite(at)) continue;
    const bucket = out.find((b) => b.day === startOfDay(at));
    if (bucket) bucket.replies++;
  }
  return out;
}

/** The latest event time for a recipient — what the Logs tab shows. */
export function lastEventAt(r: BroadcastRecipient): number | null {
  const times = [
    r.replied_at,
    r.read_at,
    r.delivered_at,
    r.sent_at,
    r.created_at,
  ]
    .map(ts)
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/**
 * Campaign speed from database counts (not a loaded list, which is
 * capped and would under-count large campaigns).
 *
 *   sending:  sends in the last `windowMs`, divided by the part of that
 *             window the campaign has actually been sending — so a run
 *             that started 3 s ago isn't diluted over 10 s.
 *   finished: sends ÷ time from first to last send (at least 1 s, so a
 *             burst of a few messages doesn't read as thousands/s).
 * Null when there's nothing to measure.
 */
export function campaignSpeed(args: {
  sending: boolean;
  now: number;
  windowMs?: number;
  recentSends: number;
  totalSends: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
}): number | null {
  const windowMs = args.windowMs ?? 10_000;
  const first = args.firstSentAt ? Date.parse(args.firstSentAt) : NaN;
  if (!Number.isFinite(first)) return null;
  if (args.sending) {
    const span = Math.min(windowMs, Math.max(1000, args.now - first)) / 1000;
    return args.recentSends / span;
  }
  const last = args.lastSentAt ? Date.parse(args.lastSentAt) : NaN;
  if (!Number.isFinite(last) || args.totalSends < 2) return null;
  // N sends span N-1 gaps: 50 sends paced at 80/s take 49/80 = 0.61 s.
  // (Dividing N by a 1 s minimum made short runs look slower.)
  const span = (last - first) / 1000;
  return span > 0 ? (args.totalSends - 1) / span : null;
}

export interface ChannelSpeed {
  /** whatsapp_config_id; null for recipients without a recorded channel. */
  channelId: string | null;
  rate: number;
}

/**
 * Speed per sending channel, each measured over its own sending time
 * (same rules as campaignSpeed). Every number has its own Meta limit, so
 * the campaign's throughput is the sum: 78 + 80 = 158 msg/s.
 */
export function channelSpeeds(
  recipients: Pick<BroadcastRecipient, 'sent_at' | 'whatsapp_config_id'>[],
  opts: { sending: boolean; now: number; windowMs?: number }
): ChannelSpeed[] {
  const windowMs = opts.windowMs ?? 10_000;
  const byChannel = new Map<string | null, number[]>();
  for (const r of recipients) {
    const t = r.sent_at ? Date.parse(r.sent_at) : NaN;
    if (!Number.isFinite(t)) continue;
    const key = r.whatsapp_config_id ?? null;
    const list = byChannel.get(key) ?? [];
    list.push(t);
    byChannel.set(key, list);
  }
  const out: ChannelSpeed[] = [];
  for (const [channelId, times] of byChannel) {
    times.sort((a, b) => a - b);
    const rate = campaignSpeed({
      sending: opts.sending,
      now: opts.now,
      windowMs,
      recentSends: times.filter((t) => t > opts.now - windowMs).length,
      totalSends: times.length,
      firstSentAt: new Date(times[0]).toISOString(),
      lastSentAt: new Date(times[times.length - 1]).toISOString(),
    });
    if (rate != null && rate > 0) out.push({ channelId, rate });
  }
  return out;
}
