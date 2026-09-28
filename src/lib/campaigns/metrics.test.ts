import { describe, expect, it } from 'vitest';

import type { BroadcastRecipient } from '@/types';
import {
  averageThroughput,
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
