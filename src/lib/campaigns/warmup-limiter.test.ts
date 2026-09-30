import { afterEach, describe, expect, it, vi } from 'vitest';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendTemplateMessage = vi.fn();
vi.mock('@/lib/whatsapp/meta-api', async (orig) => {
  const actual = await orig<typeof import('@/lib/whatsapp/meta-api')>();
  return {
    ...actual,
    sendTemplateMessage: (...a: unknown[]) => sendTemplateMessage(...a),
  };
});

import { setRedisForTests } from '@/lib/redis/client';
import type { MessageTemplate } from '@/types';
import { ChannelSender } from './channel-sender';
import { pauseCampaign } from './pause';
import { AdaptiveRateLimiter } from './rate-limiter';
import {
  DEFAULT_WARMUP,
  warmupConfigForTier,
  LocalWarmupBucket,
  WarmupLimiter,
  clearCampaignWarmup,
  resetWarmupLimiters,
  warmupConfig,
  warmupKeys,
  warmupLimiter,
  warmupRateAt,
} from './warmup-limiter';

const CFG = DEFAULT_WARMUP; // 40/s for 5 s, then 73/s
const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);

/** ioredis-mock clients on one host share a keyspace = several workers. */
let host = 0;
const newHost = () => `warmup-test-${++host}`;
const workerOn = (h: string) =>
  new RedisMock({ host: h, keyPrefix: 'wacrm:' }) as unknown as Redis;

/** A manual clock shared by the limiters of one test. */
function manualClock(start = T0) {
  let now = start;
  return { now: () => now, set: (t: number) => (now = t) };
}

/**
 * Drive tryAcquire on a fine time grid and count grants per second of
 * simulated time since `from` — the rate the channel actually got.
 */
async function grantsPerSecond(
  limiters: { l: WarmupLimiter; setClock: (t: number) => void }[],
  from: number,
  seconds: number,
  stepMs = 5
): Promise<number[][]> {
  const per = limiters.map(() => new Array(seconds).fill(0));
  for (let t = from; t < from + seconds * 1000; t += stepMs) {
    for (const [i, { l, setClock }] of limiters.entries()) {
      setClock(t);
      const r = await l.tryAcquire(1000);
      per[i][Math.floor((t - from) / 1000)] += r.granted;
    }
  }
  return per;
}

afterEach(() => {
  setRedisForTests(null);
  resetWarmupLimiters();
});

describe('config', () => {
  it('defaults to 40 TPS for 5 s, then 73 TPS', () => {
    expect(warmupConfig({})).toEqual({
      startTps: 40,
      startSeconds: 5,
      stableTps: 73,
    });
  });
  it('reads WABA_START_TPS / WABA_START_DURATION_SECONDS / WABA_STABLE_TPS', () => {
    expect(
      warmupConfig({
        WABA_START_TPS: '20',
        WABA_START_DURATION_SECONDS: '10',
        WABA_STABLE_TPS: '60',
      })
    ).toEqual({ startTps: 20, startSeconds: 10, stableTps: 60 });
  });
  it('falls back to defaults on invalid values, "off" disables', () => {
    expect(warmupConfig({ WABA_STABLE_TPS: 'fast' })?.stableTps).toBe(73);
    expect(warmupConfig({ WABA_START_TPS: 'off' })).toBeNull();
  });
  it('schedule: start rate before the switch, stable rate from it', () => {
    expect(warmupRateAt(0, CFG)).toBe(40);
    expect(warmupRateAt(4.999, CFG)).toBe(40);
    expect(warmupRateAt(5, CFG)).toBe(73);
    expect(warmupRateAt(600, CFG)).toBe(73);
  });
});

describe('warm-up through Redis', () => {
  it('1. starts immediately: the first message is granted at once', async () => {
    const clock = manualClock();
    const l = new WarmupLimiter(
      workerOn(newHost()),
      'b1',
      'pn1',
      CFG,
      clock.now
    );
    const r = await l.tryAcquire(1);
    expect(r).toMatchObject({ granted: 1, waitMs: 0, rate: 40, startedAt: T0 });
  });

  it('1b. starts immediately with real timers too (no 5 s wait)', async () => {
    const l = new WarmupLimiter(workerOn(newHost()), 'b1', 'pn1', CFG);
    const t = Date.now();
    await l.acquire();
    expect(Date.now() - t).toBeLessThan(100);
  });

  it('2 + 3. 40 TPS for the first 5 s, then 73 TPS', async () => {
    const clock = manualClock();
    const l = new WarmupLimiter(
      workerOn(newHost()),
      'b1',
      'pn1',
      CFG,
      clock.now
    );
    const [per] = await grantsPerSecond([{ l, setClock: clock.set }], T0, 9);
    for (let s = 0; s < 5; s++) {
      expect(per[s]).toBeGreaterThanOrEqual(39);
      expect(per[s]).toBeLessThanOrEqual(41);
    }
    for (let s = 5; s < 9; s++) {
      expect(per[s]).toBeGreaterThanOrEqual(72);
      expect(per[s]).toBeLessThanOrEqual(74);
    }
  });

  it('4 + 5. four channels each warm up on their own clock', async () => {
    const h = newHost();
    const clock = manualClock();
    // Channels start 0, 1, 2 and 3 s after the campaign's first send.
    const chans = [0, 1, 2, 3].map((offset) => ({
      offset,
      l: new WarmupLimiter(workerOn(h), 'b1', `pn${offset}`, CFG, clock.now),
    }));
    for (const c of chans) {
      clock.set(T0 + c.offset * 1000);
      await c.l.tryAcquire(1); // first send starts that channel's clock
    }
    for (const c of chans) {
      const start = T0 + c.offset * 1000;
      clock.set(start + 4_900);
      expect(c.l.currentRate).toBe(40);
      expect((await c.l.tryAcquire(0)).rate).toBe(40);
      clock.set(start + 5_000);
      expect((await c.l.tryAcquire(0)).rate).toBe(73);
      expect(c.l.startedAt).toBe(start);
    }
  });

  it('6. workers racing on the first send create one warm-up, one budget', async () => {
    const h = newHost();
    const clockA = manualClock();
    const clockB = manualClock(T0 + 3); // a second worker, 3 ms later
    const a = new WarmupLimiter(workerOn(h), 'b1', 'pn1', CFG, clockA.now);
    const b = new WarmupLimiter(workerOn(h), 'b1', 'pn1', CFG, clockB.now);
    const [ra, rb] = await Promise.all([a.tryAcquire(1), b.tryAcquire(1)]);
    expect(ra.startedAt).toBe(rb.startedAt); // one start time
    // Together they still get 40/s in the warm-up, not 80.
    const per = await grantsPerSecond(
      [
        { l: a, setClock: clockA.set },
        { l: b, setClock: clockB.set },
      ],
      T0 + 10,
      3
    );
    for (let s = 0; s < 3; s++) {
      const total = per[0][s] + per[1][s];
      expect(total).toBeGreaterThanOrEqual(38);
      expect(total).toBeLessThanOrEqual(42);
    }
    // And the switch to 73 happens once, at the shared start + 5 s.
    clockA.set(ra.startedAt + 5_000);
    clockB.set(ra.startedAt + 5_000);
    expect((await a.tryAcquire(0)).rate).toBe(73);
    expect((await b.tryAcquire(0)).rate).toBe(73);
  });

  it('9. a restarted worker keeps the channel at 73 (no reset to 40)', async () => {
    const h = newHost();
    const clock = manualClock();
    const before = new WarmupLimiter(workerOn(h), 'b1', 'pn1', CFG, clock.now);
    await before.tryAcquire(1);
    clock.set(T0 + 6_000);
    await before.tryAcquire(1);
    // Worker restarts: new process, new client, new limiter object.
    const after = new WarmupLimiter(workerOn(h), 'b1', 'pn1', CFG, clock.now);
    clock.set(T0 + 6_500);
    const r = await after.tryAcquire(1);
    expect(r.rate).toBe(73);
    expect(r.startedAt).toBe(T0);
  });

  it('10. other campaigns and channels are not affected', async () => {
    const h = newHost();
    const clock = manualClock();
    const aX = new WarmupLimiter(
      workerOn(h),
      'campaignA',
      'pnX',
      CFG,
      clock.now
    );
    await aX.tryAcquire(1);
    clock.set(T0 + 7_000);
    // Campaign B starts on the same number later: its own warm-up.
    const bX = new WarmupLimiter(
      workerOn(h),
      'campaignB',
      'pnX',
      CFG,
      clock.now
    );
    const aY = new WarmupLimiter(
      workerOn(h),
      'campaignA',
      'pnY',
      CFG,
      clock.now
    );
    expect((await aX.tryAcquire(0)).rate).toBe(73);
    expect((await bX.tryAcquire(1)).rate).toBe(40);
    expect((await aY.tryAcquire(1)).rate).toBe(40);
    expect(aX.startedAt).toBe(T0);
    expect(bX.startedAt).toBe(T0 + 7_000);
  });
});

describe('pause / cancel', () => {
  it('8. clears the campaign warm-up state everywhere; resuming warms up again', async () => {
    const redis = workerOn(newHost());
    setRedisForTests(redis);
    const l1 = warmupLimiter('b-pause', 'pn1', CFG)!;
    const l2 = warmupLimiter('b-pause', 'pn2', CFG)!;
    const other = warmupLimiter('b-other', 'pn1', CFG)!;
    await l1.acquire();
    await l2.acquire();
    await other.acquire();
    const k1 = warmupKeys('b-pause', 'pn1');
    expect(await redis.exists(k1.state)).toBe(1);

    await clearCampaignWarmup('b-pause');

    expect(await redis.exists(k1.state)).toBe(0);
    expect(await redis.exists(warmupKeys('b-pause', 'pn2').state)).toBe(0);
    expect(await redis.exists(k1.index)).toBe(0);
    // Another campaign keeps its state.
    expect(await redis.exists(warmupKeys('b-other', 'pn1').state)).toBe(1);
    // After a resume the channel starts over at 40.
    const again = warmupLimiter('b-pause', 'pn1', CFG)!;
    expect(again).not.toBe(l1);
    const r = await again.tryAcquire(1);
    expect(r.rate).toBe(40);
  });

  it('8b. pausing a campaign clears its warm-up', async () => {
    const redis = workerOn(newHost());
    setRedisForTests(redis);
    await warmupLimiter('b-p2', 'pn1', CFG)!.acquire();
    const db = {
      from: () => {
        const b = {
          select: () => b,
          update: () => b,
          eq: () => b,
          maybeSingle: async () => ({ data: { config: {} }, error: null }),
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: [{ id: 'b-p2' }], error: null }).then(res),
        };
        return b;
      },
    } as unknown as SupabaseClient;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await pauseCampaign(db, 'b-p2', 'test')).toBe(true);
    expect(await redis.exists(warmupKeys('b-p2', 'pn1').state)).toBe(0);
  });
});

describe('without Redis', () => {
  it('runs the same schedule in process', () => {
    const b = new LocalWarmupBucket(CFG);
    const per = new Array(8).fill(0);
    for (let t = T0; t < T0 + 8_000; t += 5)
      per[Math.floor((t - T0) / 1000)] += b.tryAcquire(1000, t).granted;
    for (let s = 0; s < 5; s++)
      expect(Math.abs(per[s] - 40)).toBeLessThanOrEqual(1);
    for (let s = 5; s < 8; s++)
      expect(Math.abs(per[s] - 73)).toBeLessThanOrEqual(1);
  });
});

describe('ChannelSender with warm-up', () => {
  const template = {
    name: 't',
    language: 'en_US',
    body_text: 'Hi',
  } as MessageTemplate;
  const job = (i: number) => ({
    phone: `9198000${String(i).padStart(5, '0')}`,
    template,
    params: {},
  });

  async function sentIn(sender: ChannelSender, ms: number): Promise<number> {
    sendTemplateMessage.mockImplementation(async () => ({ messageId: 'w' }));
    let n = 0;
    const until = Date.now() + ms;
    await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        while (Date.now() < until) {
          await sender.send(job(i));
          if (Date.now() < until) n++;
        }
      })
    );
    return n;
  }

  it(
    'sends at the warm-up rate (40/s) when the number allows more',
    { timeout: 15_000 },
    async () => {
      const sender = new ChannelSender({
        phoneNumberId: 'pn-w1',
        accessToken: 'x',
        rate: 1000,
        limiter: new AdaptiveRateLimiter(1000),
        warmup: new WarmupLimiter(null, 'b1', 'pn-w1', CFG),
        sleep: async () => {},
      });
      const n = await sentIn(sender, 1_500);
      expect(n).toBeGreaterThanOrEqual(55); // ~1.5 s × 40
      expect(n).toBeLessThanOrEqual(65);
    }
  );

  it(
    '7. still respects the per-number (global) limit when it is lower',
    { timeout: 15_000 },
    async () => {
      const sender = new ChannelSender({
        phoneNumberId: 'pn-w2',
        accessToken: 'x',
        rate: 20,
        limiter: new AdaptiveRateLimiter(20), // e.g. a lower Meta tier / shared budget
        warmup: new WarmupLimiter(null, 'b1', 'pn-w2', CFG),
        sleep: async () => {},
      });
      const n = await sentIn(sender, 1_500);
      expect(n).toBeLessThanOrEqual(33); // ~1.5 s × 19.5, not 40
      expect(sender.effectiveRate).toBeLessThanOrEqual(20);
    }
  );
});

describe('standard vs high-throughput channels', () => {
  it('standard numbers (80/s tier): 40 → 73; high (1 000/s tier): 40 → 820', () => {
    expect(warmupConfigForTier(80, {})).toEqual({
      startTps: 40,
      startSeconds: 5,
      stableTps: 73,
    });
    expect(warmupConfigForTier(1000, {})).toEqual({
      startTps: 40,
      startSeconds: 5,
      stableTps: 820,
    });
  });

  it('reads WABA_HIGH_START_TPS / WABA_HIGH_STABLE_TPS; duration is shared', () => {
    const env = {
      WABA_START_DURATION_SECONDS: '8',
      WABA_HIGH_START_TPS: '100',
      WABA_HIGH_STABLE_TPS: '900',
    };
    expect(warmupConfigForTier(1000, env)).toEqual({
      startTps: 100,
      startSeconds: 8,
      stableTps: 900,
    });
    expect(warmupConfigForTier(80, env)?.stableTps).toBe(73);
  });

  it('off disables it for both', () => {
    expect(warmupConfigForTier(80, { WABA_START_TPS: 'off' })).toBeNull();
    expect(warmupConfigForTier(1000, { WABA_START_TPS: 'off' })).toBeNull();
  });

  it('a high-throughput channel really runs 40/s, then 820/s', async () => {
    const cfg = warmupConfigForTier(1000, {})!;
    const clock = manualClock();
    const l = new WarmupLimiter(
      workerOn(newHost()),
      'b1',
      'pn-high',
      cfg,
      clock.now
    );
    const [per] = await grantsPerSecond([{ l, setClock: clock.set }], T0, 7, 2);
    for (let s = 0; s < 5; s++)
      expect(Math.abs(per[s] - 40)).toBeLessThanOrEqual(1);
    for (let s = 5; s < 7; s++)
      expect(Math.abs(per[s] - 820)).toBeLessThanOrEqual(10);
  });
});
