import { describe, expect, it } from 'vitest';

import type { BroadcastRecipient } from '@/types';
import {
  averageThroughput,
  campaignSpeed,
  channelSpeeds,
  campaignEvents,
  currentThroughput,
  etaSeconds,
  failureReasons,
  lastEventAt,
  parseFailure,
  processingTimeline,
  replyTrend,
} from './metrics';

const T0 = Date.UTC(2026, 8, 27, 10, 0, 0);
const iso = (offsetSec: number) =>
  new Date(T0 + offsetSec * 1000).toISOString();

function r(over: Partial<BroadcastRecipient>): BroadcastRecipient {
  return {
    id: Math.random().toString(36),
    broadcast_id: 'b1',
    contact_id: 'c1',
    status: 'pending',
    created_at: iso(0),
    ...over,
  } as BroadcastRecipient;
}

describe('campaign metrics', () => {
  it('parses the webhook failure format', () => {
    expect(
      parseFailure(
        '[131049] Not delivered to maintain engagement: details here'
      )
    ).toEqual({
      code: 131049,
      title: 'Not delivered to maintain engagement',
    });
    expect(parseFailure('No valid phone number on contact')).toEqual({
      code: null,
      title: 'No valid phone number on contact',
    });
  });

  it('groups failures by Meta code, largest first', () => {
    const reasons = failureReasons([
      r({ status: 'failed', error_message: '[131026] Undeliverable' }),
      r({ status: 'failed', error_message: '[131049] Engagement: x' }),
      r({ status: 'failed', error_message: '[131049] Engagement: y' }),
      r({ status: 'delivered' }),
    ]);
    expect(reasons).toEqual([
      { code: 131049, title: 'Engagement', count: 2 },
      { code: 131026, title: 'Undeliverable', count: 1 },
    ]);
  });

  it('measures throughput from real send times', () => {
    const recs = [
      r({ sent_at: iso(0) }),
      r({ sent_at: iso(30) }),
      r({ sent_at: iso(59) }),
      r({ sent_at: iso(-120) }),
    ];
    expect(currentThroughput(recs, T0 + 60_000)).toBeCloseTo(3 / 60);
    expect(averageThroughput(recs)).toBeCloseTo(4 / 179);
    expect(averageThroughput([r({ sent_at: iso(0) })])).toBeNull();
  });

  it('estimates ETA only when something is moving', () => {
    expect(etaSeconds(100, 2)).toBe(50);
    expect(etaSeconds(100, 0)).toBeNull();
    expect(etaSeconds(0, 0)).toBe(0);
  });

  it('builds a cumulative timeline that ends at the totals', () => {
    const recs = [
      r({ sent_at: iso(0), delivered_at: iso(5), read_at: iso(20) }),
      r({ sent_at: iso(10), delivered_at: iso(15) }),
      r({ sent_at: iso(40) }),
    ];
    const tl = processingTimeline(recs, 4);
    expect(tl).toHaveLength(5);
    expect(tl.at(-1)).toMatchObject({ sent: 3, delivered: 2, read: 1 });
    for (let i = 1; i < tl.length; i++)
      expect(tl[i].sent).toBeGreaterThanOrEqual(tl[i - 1].sent);
    expect(processingTimeline([r({})])).toEqual([]);
  });

  it('counts replies per day and lists events newest first', () => {
    const now = T0 + 3 * 86_400_000;
    const recs = [
      r({ replied_at: iso(10) }),
      r({ replied_at: new Date(now).toISOString() }),
      r({ sent_at: iso(5), status: 'failed' }),
    ];
    const trend = replyTrend(recs, now, 4);
    expect(trend).toHaveLength(4);
    expect(trend.reduce((a, d) => a + d.replies, 0)).toBe(2);
    expect(trend.at(-1)!.replies).toBe(1);

    const events = campaignEvents(recs);
    expect(events[0].kind).toBe('replied');
    expect(events.map((e) => e.kind)).toContain('failed');
    expect(lastEventAt(recs[0])).toBe(T0 + 10_000);
  });
});

describe('campaignSpeed', () => {
  const now = Date.parse('2026-09-29T10:00:30Z');
  it('live: sends in the last 10 s over the part of the window spent sending', () => {
    expect(
      campaignSpeed({
        sending: true,
        now,
        recentSends: 760,
        totalSends: 5000,
        firstSentAt: '2026-09-29T09:59:00Z',
        lastSentAt: null,
      })
    ).toBe(76);
    // Started 4 s ago: 300 sends over 4 s, not over 10 s.
    expect(
      campaignSpeed({
        sending: true,
        now,
        recentSends: 300,
        totalSends: 300,
        firstSentAt: '2026-09-29T10:00:26Z',
        lastSentAt: null,
      })
    ).toBe(75);
  });
  it('finished: the pace between first and last send (N-1 gaps)', () => {
    expect(
      campaignSpeed({
        sending: false,
        now,
        recentSends: 0,
        totalSends: 20000,
        firstSentAt: '2026-09-29T10:00:00Z',
        lastSentAt: '2026-09-29T10:00:21Z',
      })
    ).toBeCloseTo(952.3, 1);
    expect(
      campaignSpeed({
        sending: false,
        now,
        recentSends: 0,
        totalSends: 50,
        firstSentAt: '2026-09-29T10:00:00.000Z',
        lastSentAt: '2026-09-29T10:00:00.612Z',
      })
      // 50 sends paced at 80/s: a short run still reads 80, not 50.
    ).toBeCloseTo(80, 0);
  });
  it('nothing to measure → null', () => {
    expect(
      campaignSpeed({
        sending: true,
        now,
        recentSends: 0,
        totalSends: 0,
        firstSentAt: null,
        lastSentAt: null,
      })
    ).toBeNull();
    expect(
      campaignSpeed({
        sending: false,
        now,
        recentSends: 0,
        totalSends: 1,
        firstSentAt: '2026-09-29T10:00:00Z',
        lastSentAt: '2026-09-29T10:00:00Z',
      })
    ).toBeNull();
  });
});

describe('channelSpeeds', () => {
  const at = (sec: number) =>
    new Date(Date.UTC(2026, 8, 29, 10, 0, 0) + sec * 1000).toISOString();
  const sends = (channel: string, count: number, overSec: number) =>
    Array.from({ length: count }, (_, i) => ({
      whatsapp_config_id: channel,
      sent_at: at((i * overSec) / (count - 1)),
    }));

  it('finished: each channel over its own sending time, so they add up', () => {
    const speeds = channelSpeeds(
      [...sends('a', 781, 10), ...sends('b', 801, 10)],
      {
        sending: false,
        now: Date.now(),
      }
    );
    const byId = Object.fromEntries(speeds.map((s) => [s.channelId, s.rate]));
    expect(byId.a).toBeCloseTo(78, 1);
    expect(byId.b).toBeCloseTo(80, 1);
    expect(byId.a + byId.b).toBeCloseTo(158, 1);
  });

  it('a channel that finished early is not diluted by the slower one', () => {
    // a: 100 in 1 s, b: 800 in 10 s — the old whole-campaign average would
    // give 900 / 10 = 90; per channel it is 100 + 80.
    const speeds = channelSpeeds(
      [...sends('a', 101, 1), ...sends('b', 801, 10)],
      {
        sending: false,
        now: Date.now(),
      }
    );
    const total = speeds.reduce((s, c) => s + c.rate, 0);
    expect(total).toBeCloseTo(180, 0);
  });

  it('live: sends in the last 10 s per channel', () => {
    const now = Date.parse(at(20));
    const recent = (channel: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        whatsapp_config_id: channel,
        sent_at: at(10.5 + (i * 9) / count),
      }));
    const speeds = channelSpeeds(
      [
        ...sends('a', 50, 5),
        ...recent('a', 780),
        ...sends('b', 50, 5),
        ...recent('b', 800),
      ],
      { sending: true, now }
    );
    const byId = Object.fromEntries(speeds.map((s) => [s.channelId, s.rate]));
    expect(byId.a).toBe(78);
    expect(byId.b).toBe(80);
  });

  it('skips unsent rows and channels with nothing to measure', () => {
    expect(
      channelSpeeds([{ whatsapp_config_id: 'a', sent_at: undefined }], {
        sending: false,
        now: 0,
      })
    ).toEqual([]);
  });
});
