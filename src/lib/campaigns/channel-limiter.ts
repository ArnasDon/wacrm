// ============================================================
// One speed limit per WhatsApp number, shared by everything that sends
// through it.
//
//   Channel 1 … Channel N   (Meta: 80 or 1 000 msg/s per number)
//        └──── Redis ────┘   one token bucket per number
//               │
//             Kafka → workers → Meta Cloud API
//
// Meta's limit is per phone number, not per campaign or per server. So
// every campaign and every worker sending through a number draws from
// the same bucket: two campaigns on one 80/s number share 80/s, and
// ten workers draining Kafka together still send 80/s.
//
// The bucket is adaptive and shared too: a 130429 seen by any worker
// lowers the rate for all of them, and all of them climb back together.
//
//   * REDIS_URL set   → RedisChannelLimiter (bucket state in a Redis
//                       hash, updated atomically by one Lua script).
//                       Timed by the workers' clocks (NTP / Amazon Time
//                       Sync keep them within a millisecond); the script
//                       never lets the bucket's time run backwards.
//   * no Redis        → one AdaptiveRateLimiter per number per process
//                       (campaigns in the same process still share).
//   * Redis goes down → that process falls back to local pacing and
//                       retries Redis every few seconds. Never throws.
// ============================================================

import type Redis from 'ioredis';

import { getRedis, logRedisError } from '@/lib/redis/client';
import {
  AdaptiveRateLimiter,
  LIMITER_HEADROOM,
  LIMITER_PROBE,
} from './rate-limiter';

export interface ChannelLimiter {
  acquire(): Promise<void>;
  penalize(pauseMs?: number): void;
  pause(ms: number): void;
  readonly currentRate: number;
  readonly pending: number;
}

// Same algorithm as AdaptiveRateLimiter, on shared state. ARGV[1] is the
// number's max rate, ARGV[3] the caller's clock. Times are float seconds
// (ms since 1970 would overflow the 32-bit integers of some test
// doubles). A missing hash field is nil or false depending on the
// server — `tonumber(x) or d` handles both.
//
// Not redis TIME: Redis < 5 refuses writes after it in a script. A
// caller whose clock is slightly behind the last writer's is treated as
// "now = last" (no tokens earned, none lost); one more than 2 s off is
// trusted instead, so a single bad clock can't freeze everyone.
const READ_STATE = `
local now = tonumber(ARGV[3])
local max = tonumber(ARGV[1])
local h = redis.call('HMGET', KEYS[1], 'tokens', 'last', 'rate', 'ceiling', 'paused', 'max', 'penalty')
local tokens = tonumber(h[1]) or 0
local last = tonumber(h[2]) or now
local rate = tonumber(h[3]) or max * ${LIMITER_HEADROOM}
local ceiling = tonumber(h[4]) or max
local paused = tonumber(h[5]) or 0
local oldmax = tonumber(h[6]) or max
local penalty = tonumber(h[7]) or 0
if now < last and last - now < 2 then now = last end
if oldmax ~= max then
  -- The number's tier changed (e.g. upgraded to 1 000/s).
  ceiling = max
  if rate > max then rate = max end
end
`;

const WRITE_STATE = `
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'last', tostring(now),
  'rate', tostring(rate), 'ceiling', tostring(ceiling), 'paused', tostring(paused),
  'max', tostring(max), 'penalty', tostring(penalty))
redis.call('PEXPIRE', KEYS[1], 3600000)
`;

/** ARGV: max rate, slots wanted → { granted, wait ms, current rate }. */
const ACQUIRE_LUA = `${READ_STATE}
local want = tonumber(ARGV[2])
local elapsed = now - last
if elapsed < 0 then elapsed = 0 end
local granted = 0
local wait = 0
if now < paused then
  wait = paused - now
else
  local target = ceiling * ${LIMITER_HEADROOM}
  if rate < target then
    rate = math.min(target, rate + max * 0.2 * elapsed)
  else
    rate = rate + max * ${LIMITER_PROBE} * elapsed
  end
  if rate > max then rate = max end
  ceiling = math.min(max * 2, ceiling + max * ${LIMITER_PROBE} * elapsed)
  local burst = math.max(1.5, rate / 100)
  tokens = math.min(burst, tokens + rate * elapsed)
  granted = math.min(want, math.floor(tokens))
  tokens = tokens - granted
  if granted < want then wait = (1 - tokens) / rate end
end
${WRITE_STATE}
return { granted, math.ceil(wait * 1000), tostring(rate) }
`;

/** ARGV: max rate, hold seconds. Once per burst, like the local one. */
const PENALIZE_LUA = `${READ_STATE}
local hold = tonumber(ARGV[2])
if now < penalty + math.max(hold, 0.5) then return 0 end
penalty = now
ceiling = rate
rate = math.max(1, rate * 0.9)
tokens = 0
paused = math.max(paused, now + hold)
${WRITE_STATE}
return 1
`;

/** ARGV: max rate, seconds. */
const PAUSE_LUA = `${READ_STATE}
paused = math.max(paused, now + tonumber(ARGV[2]))
${WRITE_STATE}
return 1
`;

type LimiterRedis = Redis & {
  wacrmLimiterAcquire(
    key: string,
    max: number,
    want: number,
    now: number
  ): Promise<[number, number, string]>;
  wacrmLimiterPenalize(
    key: string,
    max: number,
    holdS: number,
    now: number
  ): Promise<number>;
  wacrmLimiterPause(
    key: string,
    max: number,
    seconds: number,
    now: number
  ): Promise<number>;
};

function withScripts(redis: Redis): LimiterRedis {
  const r = redis as LimiterRedis;
  if (typeof r.wacrmLimiterAcquire !== 'function') {
    redis.defineCommand('wacrmLimiterAcquire', {
      numberOfKeys: 1,
      lua: ACQUIRE_LUA,
    });
    redis.defineCommand('wacrmLimiterPenalize', {
      numberOfKeys: 1,
      lua: PENALIZE_LUA,
    });
    redis.defineCommand('wacrmLimiterPause', {
      numberOfKeys: 1,
      lua: PAUSE_LUA,
    });
  }
  return r;
}

const nowS = () => Date.now() / 1000;

/** How long a process paces locally after a Redis error before retrying. */
const REDIS_RETRY_MS = 5_000;

export class RedisChannelLimiter implements ChannelLimiter {
  private readonly redis: LimiterRedis;
  private readonly key: string;
  private waiters: (() => void)[] = [];
  private pumping = false;
  private rate: number;
  private redisDownUntil = 0;
  /** Used while Redis is unreachable. */
  private readonly local: AdaptiveRateLimiter;

  constructor(
    redis: Redis,
    phoneNumberId: string,
    private maxRate: number
  ) {
    this.redis = withScripts(redis);
    this.key = `ratelimit:channel:${phoneNumberId}`;
    this.rate = maxRate * LIMITER_HEADROOM;
    this.local = new AdaptiveRateLimiter(maxRate);
  }

  get currentRate(): number {
    return this.useLocal() ? this.local.currentRate : this.rate;
  }

  get pending(): number {
    return this.waiters.length;
  }

  setMaxRate(maxRate: number): void {
    this.maxRate = Math.max(1, maxRate);
    this.local.setMaxRate(this.maxRate);
  }

  acquire(): Promise<void> {
    // Always one queue and one pump, whichever pacer is used: sending
    // some requests through the local fallback and others through Redis
    // at the same time would run two full-speed pacers on one number
    // (seen as ~156/s on an 80/s number right after Redis came up).
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      void this.pump();
    });
  }

  penalize(pauseMs = 1000): void {
    const holdS = Math.min(pauseMs, 100) / 1000;
    this.local.penalize(pauseMs);
    if (this.useLocal()) return;
    this.redis
      .wacrmLimiterPenalize(this.key, this.maxRate, holdS, nowS())
      .catch((err) => this.redisFailed(err));
  }

  pause(ms: number): void {
    this.local.pause(ms);
    if (this.useLocal()) return;
    this.redis
      .wacrmLimiterPause(this.key, this.maxRate, ms / 1000, nowS())
      .catch((err) => this.redisFailed(err));
  }

  private useLocal(): boolean {
    // Still connecting / reconnecting (test doubles have no status), or
    // failed a moment ago.
    const status = this.redis.status as string | undefined;
    if (status && status !== 'ready') return true;
    return Date.now() < this.redisDownUntil;
  }

  private redisFailed(err: unknown): void {
    logRedisError(err);
    this.redisDownUntil = Date.now() + REDIS_RETRY_MS;
  }

  /**
   * One request to Redis at a time per limiter, asking for as many slots
   * as there are waiters; the script grants what the bucket holds and
   * says how long until the next slot.
   */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length) {
        if (this.useLocal()) {
          // Redis not reachable (yet): pace from the local fallback, one
          // slot at a time, so switching back to Redis never overlaps.
          await this.local.acquire();
          this.waiters.shift()?.();
          continue;
        }
        let granted: number;
        let waitMs: number;
        try {
          const [g, w, rate] = await this.redis.wacrmLimiterAcquire(
            this.key,
            this.maxRate,
            this.waiters.length,
            nowS()
          );
          granted = Number(g);
          waitMs = Number(w);
          this.rate = Number(rate) || this.rate;
        } catch (err) {
          this.redisFailed(err);
          continue;
        }
        for (const w of this.waiters.splice(0, granted)) w();
        if (this.waiters.length) {
          await new Promise((r) => setTimeout(r, Math.max(1, waitMs)));
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}

// ── Registry: one limiter per number per process ────────────────

const g = globalThis as unknown as {
  __wacrmChannelLimiters?: Map<
    string,
    ChannelLimiter & { setMaxRate(n: number): void }
  >;
};

/**
 * The limiter for a WhatsApp number. Every sender for that number in
 * this process gets the same one; with Redis, every process shares its
 * bucket too.
 */
export function channelLimiter(
  phoneNumberId: string,
  maxRate: number
): ChannelLimiter {
  const map = (g.__wacrmChannelLimiters ??= new Map());
  let limiter = map.get(phoneNumberId);
  if (!limiter) {
    const redis = getRedis();
    limiter = redis
      ? new RedisChannelLimiter(redis, phoneNumberId, maxRate)
      : new AdaptiveRateLimiter(maxRate);
    map.set(phoneNumberId, limiter);
  } else {
    limiter.setMaxRate(maxRate);
  }
  return limiter;
}

/** For tests. */
export function resetChannelLimiters(): void {
  g.__wacrmChannelLimiters?.clear();
}
