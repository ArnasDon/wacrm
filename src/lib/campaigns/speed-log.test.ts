import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendTemplateMessage = vi.fn();
vi.mock('@/lib/whatsapp/meta-api', async (orig) => {
  const actual = await orig<typeof import('@/lib/whatsapp/meta-api')>();
  return {
    ...actual,
    sendTemplateMessage: (...a: unknown[]) => sendTemplateMessage(...a),
  };
});

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import type { MessageTemplate } from '@/types';
import { ChannelSender } from './channel-sender';
import { AdaptiveRateLimiter } from './rate-limiter';
import {
  CampaignSpeedLog,
  speedSeconds,
  type SpeedEventInfo,
  type SpeedLogRow,
} from './speed-log';

vi.spyOn(console, 'warn').mockImplementation(() => {});

function fakeDb(fail?: string) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      insert: async (rows: Record<string, unknown>[]) => {
        if (fail) return { error: { message: fail } };
        inserted.push(...rows);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { db, inserted };
}

const T = Date.UTC(2026, 8, 29, 10, 0, 0);

describe('CampaignSpeedLog', () => {
  it('counts events per channel per second and writes them on flush', async () => {
    const { db, inserted } = fakeDb();
    const log = new CampaignSpeedLog(db, 'acc', 'b1');
    const a = log.forChannel('ch-a');
    const e = (type: SpeedEventInfo['type'], ms: number) => ({
      type,
      at: T + ms,
      rate: 78.8,
    });
    a(e('sent', 10));
    a(e('sent', 500));
    a(e('accepted', 900));
    a(e('throttled', 950));
    a(e('sent', 1_100)); // next second
    log.forChannel('ch-b')(e('sent', 20));
    await log.flush();

    const row = (ch: string, sec: number) =>
      inserted.find(
        (r) =>
          r.whatsapp_config_id === ch &&
          r.second === new Date(T + sec * 1000).toISOString()
      );
    expect(row('ch-a', 0)).toMatchObject({
      account_id: 'acc',
      broadcast_id: 'b1',
      sent: 2,
      accepted: 1,
      throttled: 1,
      failed: 0,
      limit_rate: 78.8,
    });
    expect(row('ch-a', 1)).toMatchObject({ sent: 1 });
    expect(row('ch-b', 0)).toMatchObject({ sent: 1 });
    expect(inserted).toHaveLength(3);
  });

  it('turns itself off when the table does not exist, without throwing', async () => {
    const { db } = fakeDb(
      'relation "public.campaign_speed_log" does not exist'
    );
    const log = new CampaignSpeedLog(db, 'acc', 'b1');
    log.record('ch', { type: 'sent', at: T, rate: 80 });
    await expect(log.flush()).resolves.toBeUndefined();
    log.record('ch', { type: 'sent', at: T, rate: 80 }); // ignored now
    await expect(log.flush()).resolves.toBeUndefined();
  });
});

describe('speedSeconds', () => {
  const row = (
    ch: string,
    sec: number,
    o: Partial<SpeedLogRow>
  ): SpeedLogRow => ({
    whatsapp_config_id: ch,
    second: new Date(T + sec * 1000).toISOString(),
    sent: 0,
    accepted: 0,
    throttled: 0,
    failed: 0,
    limit_rate: 80,
    ...o,
  });

  it('adds up channels and workers per second, and shows pauses as zeros', () => {
    const s = speedSeconds([
      row('a', 0, { sent: 40, accepted: 39, limit_rate: 78.8 }),
      row('a', 0, { sent: 39, accepted: 38, limit_rate: 78.8 }), // 2nd worker, same channel
      row('b', 0, { sent: 80, accepted: 80, limit_rate: 80 }),
      row('a', 3, { sent: 10, accepted: 10 }),
    ]);
    expect(s.map((x) => x.sent)).toEqual([159, 0, 0, 10]);
    expect(s[0].accepted).toBe(157);
    // Limit per channel is shared by its workers (max), summed across channels.
    expect(s[0].limit).toBeCloseTo(158.8);
    expect(s[0].byChannel.a.sent).toBe(79);
  });
});

describe('ChannelSender speed events', () => {
  const template = {
    name: 't',
    language: 'en_US',
    body_text: 'Hi',
  } as MessageTemplate;
  const make = (events: SpeedEventInfo[]) =>
    new ChannelSender({
      phoneNumberId: 'p-events',
      accessToken: 'x',
      rate: 1000,
      limiter: new AdaptiveRateLimiter(1000),
      sleep: async () => {},
      onEvent: (e) => events.push(e),
    });

  it('sent + accepted for a success; sent + throttled, then retry', async () => {
    const events: SpeedEventInfo[] = [];
    const s = make(events);
    s.limiter.penalize = vi.fn();
    sendTemplateMessage
      .mockRejectedValueOnce(
        new MetaApiError('Rate limit hit', { code: 130429, httpStatus: 400 })
      )
      .mockResolvedValueOnce({ messageId: 'w1' });
    const res = await s.send({ phone: '919800000001', template, params: {} });
    expect(res.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'sent',
      'throttled',
      'sent',
      'accepted',
    ]);
    expect(events.every((e) => e.rate > 0)).toBe(true);
  });

  it('sent + failed for a rejected message', async () => {
    const events: SpeedEventInfo[] = [];
    sendTemplateMessage.mockRejectedValueOnce(
      new MetaApiError('Message undeliverable', {
        code: 131026,
        httpStatus: 400,
      })
    );
    const res = await make(events).send({
      phone: '919800000002',
      template,
      params: {},
    });
    expect(res.ok).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['sent', 'failed']);
  });
});

describe('speed log system details', () => {
  it('each row records the worker, its memory / CPU / load and the limits', async () => {
    const { db, inserted } = fakeDb();
    const log = new CampaignSpeedLog(db, 'acc', 'b1', 'kafka');
    log.forChannel('ch')({
      type: 'sent',
      at: T,
      rate: 78.8,
      inFlight: 64,
      maxInFlight: 200,
      tierRate: 80,
      capRate: 80,
    });
    await log.flush();
    const row = inserted[0];
    expect(row).toMatchObject({
      path: 'kafka',
      role: 'app',
      in_flight: 64,
      max_in_flight: 200,
      tier_rate: 80,
      cap_rate: 80,
      limit_rate: 78.8,
    });
    expect(String(row.worker)).toMatch(/:\d+$/); // host:pid
    expect(row.rss_mb).toBeGreaterThan(0);
    expect(typeof row.cpu_pct).toBe('number');
    expect(typeof row.load_avg).toBe('number');
  });

  it('falls back to the basic columns if migration 057 is missing', async () => {
    const inserted: Record<string, unknown>[] = [];
    let calls = 0;
    const db = {
      from: () => ({
        insert: async (rows: Record<string, unknown>[]) => {
          calls++;
          if ('worker' in rows[0])
            return { error: { message: 'column "worker" does not exist' } };
          inserted.push(...rows);
          return { error: null };
        },
      }),
    } as unknown as SupabaseClient;
    const log = new CampaignSpeedLog(db, 'acc', 'b1');
    log.record('ch', { type: 'sent', at: T, rate: 80 });
    await log.flush();
    expect(calls).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).not.toHaveProperty('worker');
  });

  it('per second: counts workers, adds their memory and CPU, keeps the worst load', () => {
    const base = {
      second: new Date(T).toISOString(),
      accepted: 0,
      throttled: 0,
      failed: 0,
      limit_rate: 79,
      tier_rate: 80,
      cap_rate: 80,
      max_in_flight: 200,
    };
    const [s] = speedSeconds([
      {
        ...base,
        whatsapp_config_id: 'a',
        sent: 40,
        worker: 'h:1',
        role: 'kafka-worker',
        rss_mb: 300,
        cpu_pct: 20,
        load_avg: 1.5,
        in_flight: 30,
      },
      {
        ...base,
        whatsapp_config_id: 'a',
        sent: 39,
        worker: 'h:2',
        role: 'kafka-worker',
        rss_mb: 250,
        cpu_pct: 15,
        load_avg: 2.0,
        in_flight: 28,
      },
    ]);
    expect(s.workers).toBe(2);
    expect(s.rssMb).toBe(550);
    expect(s.cpuPct).toBe(35);
    expect(s.loadAvg).toBe(2);
    expect(s.inFlight).toBe(58);
    expect(s.limit).toBe(79); // shared number limit: not doubled
    expect(s.tier).toBe(80);
    expect(s.byWorker['h:1'].sent).toBe(40);
  });
});
