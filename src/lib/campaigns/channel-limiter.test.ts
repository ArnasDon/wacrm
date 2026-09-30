import { afterEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';

import { setRedisForTests } from '@/lib/redis/client';
import {
  RedisChannelLimiter,
  channelLimiter,
  resetChannelLimiters,
} from './channel-limiter';
import { AdaptiveRateLimiter } from './rate-limiter';

// ioredis-mock instances with the same host share one in-memory
// keyspace — two of them stand in for two worker processes.
const worker = () =>
  new RedisMock({ host: 'shared', keyPrefix: 'wacrm:' }) as unknown as Redis;

/** Acquire as fast as allowed for `ms`; returns how many got through. */
async function drain(limiters: RedisChannelLimiter[], ms: number) {
  const until = Date.now() + ms;
  const counts = limiters.map(() => 0);
  await Promise.all(
    limiters.map(async (l, i) => {
      // Many concurrent senders per worker, like a real campaign.
      await Promise.all(
        Array.from({ length: 20 }, async () => {
          while (Date.now() < until) {
            await l.acquire();
            if (Date.now() < until) counts[i]++;
          }
        })
      );
    })
  );
  return counts;
}

afterEach(() => {
  setRedisForTests(null);
  resetChannelLimiters();
});

describe('RedisChannelLimiter', () => {
  it('two workers on one 80/s number share 80/s between them', async () => {
    const pn = `pn-${Math.random()}`;
    const a = new RedisChannelLimiter(worker(), pn, 80);
    const b = new RedisChannelLimiter(worker(), pn, 80);
    const [ca, cb] = await drain([a, b], 1_500);
    const total = ca + cb;
    // ~1.5 s × 78/s ≈ 117 (starts at 97.5 % of the tier).
    expect(total).toBeGreaterThanOrEqual(100);
    expect(total).toBeLessThanOrEqual(125);
    // Both got a real share, not one starving the other.
    expect(Math.min(ca, cb)).toBeGreaterThan(total * 0.25);
  });

  it('different numbers have their own limits', async () => {
    const a = new RedisChannelLimiter(worker(), `pn-a-${Math.random()}`, 80);
    const b = new RedisChannelLimiter(worker(), `pn-b-${Math.random()}`, 80);
    const [ca, cb] = await drain([a, b], 1_000);
    expect(ca).toBeGreaterThanOrEqual(65);
    expect(cb).toBeGreaterThanOrEqual(65);
  });

  it('a throttle seen by one worker slows the other', async () => {
    const pn = `pn-${Math.random()}`;
    const redisA = worker();
    const redisB = worker();
    const a = new RedisChannelLimiter(redisA, pn, 80);
    const b = new RedisChannelLimiter(redisB, pn, 80);
    await drain([a], 100);
    const key = `ratelimit:channel:${pn}`;
    const before = Number(await redisB.hget(key, 'rate'));
    a.penalize();
    await new Promise((r) => setTimeout(r, 100));
    // Worker B sees the cut in the shared state: 10 % lower, and the
    // throttle point remembered as the new ceiling.
    expect(Number(await redisB.hget(key, 'rate'))).toBeCloseTo(before * 0.9);
    expect(Number(await redisB.hget(key, 'ceiling'))).toBeCloseTo(before);
    await drain([b], 20);
    expect(b.currentRate).toBeLessThan(before);
  });

  it('falls back to local pacing when Redis fails, and keeps sending', async () => {
    const l = new RedisChannelLimiter(worker(), `pn-${Math.random()}`, 80);
    (l as unknown as { redis: object }).redis = {
      wacrmLimiterAcquire: () => Promise.reject(new Error('ECONNREFUSED')),
      wacrmLimiterPenalize: () => Promise.reject(new Error('ECONNREFUSED')),
      wacrmLimiterPause: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    const [n] = await drain([l], 1_000);
    expect(n).toBeGreaterThanOrEqual(65);
    expect(n).toBeLessThanOrEqual(85);
  });
});

describe('RedisChannelLimiter while Redis connects', () => {
  it('never paces from local and Redis at once (no double speed)', async () => {
    const redis = worker() as unknown as { status?: string };
    redis.status = 'connecting'; // not ready: local fallback paces
    const l = new RedisChannelLimiter(
      redis as unknown as Redis,
      `pn-${Math.random()}`,
      80
    );
    const until = Date.now() + 1_500;
    let n = 0;
    for (let i = 0; i < 1_000; i++)
      void l.acquire().then(() => {
        if (Date.now() < until) n++;
      });
    setTimeout(() => (redis.status = 'ready'), 500); // Redis comes up mid-run
    await new Promise((r) => setTimeout(r, 1_600));
    // 1.5 s at ~78/s ≈ 117 — not ~234 from two pacers at once.
    expect(n).toBeGreaterThanOrEqual(95);
    expect(n).toBeLessThanOrEqual(130);
  });
});

describe('channelLimiter registry', () => {
  it('one limiter per number per process; local without Redis', () => {
    setRedisForTests(null);
    const a = channelLimiter('p1', 80);
    expect(a).toBeInstanceOf(AdaptiveRateLimiter);
    expect(channelLimiter('p1', 80)).toBe(a);
    expect(channelLimiter('p2', 80)).not.toBe(a);
  });

  it('uses Redis when configured', () => {
    setRedisForTests(worker());
    expect(channelLimiter('p1', 80)).toBeInstanceOf(RedisChannelLimiter);
  });
});
