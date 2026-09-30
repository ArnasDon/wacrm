// ============================================================
// Per-campaign, per-channel warm-up rate.
//
// When a campaign starts sending on a channel (WhatsApp number), that
// channel runs at WABA_START_TPS (default 40 msg/s) for
// WABA_START_DURATION_SECONDS (default 5), then at WABA_STABLE_TPS
// (default 73) for the rest of the campaign. High-throughput numbers
// (Meta tier 1 000/s) use WABA_HIGH_START_TPS → WABA_HIGH_STABLE_TPS
// (default 40 → 820) — see warmupConfigForTier.
//
//   * The clock starts with the channel's FIRST send in the campaign —
//     no waiting, the first message goes immediately — and each
//     (campaign, channel) has its own clock: four channels warm up
//     independently, and another campaign on the same number has its own.
//   * State lives in Redis, one hash per (campaign, channel), and is
//     read and written by one Lua script (atomic): the first caller of
//     any worker sets the start time, everyone else reads it, and the
//     40 → 73 switch is just "now − start ≥ 5 s" — nothing to race over,
//     no timers. A restarted worker reads the same start time, so an
//     already-warm channel stays at 73.
//   * It's a token bucket like the per-number limiter and runs IN FRONT
//     of it (ChannelSender): a send needs a warm-up slot and a per-number
//     slot, so the effective rate is min(warm-up, the number's limit).
//     Meta's tier and the shared per-number budget still apply.
//   * Cleared when the campaign pauses, finishes or fails
//     (clearCampaignWarmup); otherwise it expires an hour after the last
//     send. Resuming a paused campaign warms up again.
//   * Without Redis (or while it's unreachable) the same schedule runs
//     per process.
// ============================================================

import type Redis from 'ioredis';

import { getRedis, logRedisError } from '@/lib/redis/client';

export interface WarmupConfig {
  startTps: number;
  startSeconds: number;
  stableTps: number;
}

export const DEFAULT_WARMUP: WarmupConfig = {
  startTps: 40,
  startSeconds: 5,
  stableTps: 73,
};

/** State expires this long after the channel's last send. */
export const WARMUP_TTL_SECONDS = 3600;

function num(
  raw: string | undefined,
  def: number,
  min: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    console.warn(`[warmup] ${name}="${raw}" is invalid; using ${def}`);
    return def;
  }
  return n;
}

/** From WABA_START_TPS / WABA_START_DURATION_SECONDS / WABA_STABLE_TPS; null = off. */
export function warmupConfig(
  env: Record<string, string | undefined> = process.env
): WarmupConfig | null {
  if (
    ['off', 'false', '0'].includes(
      env.WABA_START_TPS?.trim().toLowerCase() ?? ''
    )
  )
    return null;
  return {
    startTps: num(
      env.WABA_START_TPS,
      DEFAULT_WARMUP.startTps,
      0.1,
      'WABA_START_TPS'
    ),
    startSeconds: num(
      env.WABA_START_DURATION_SECONDS,
      DEFAULT_WARMUP.startSeconds,
      0,
      'WABA_START_DURATION_SECONDS'
    ),
    stableTps: num(
      env.WABA_STABLE_TPS,
      DEFAULT_WARMUP.stableTps,
      0.1,
      'WABA_STABLE_TPS'
    ),
  };
}

/** Defaults for high-throughput numbers (Meta tier 1 000 msg/s). */
export const DEFAULT_HIGH_WARMUP = { startTps: 40, stableTps: 820 };
/** Meta tiers at or above this count as high throughput. */
const HIGH_TIER_RATE = 1000;

/**
 * The warm-up for a number of the given Meta tier: standard numbers
 * (80/s) use WABA_START_TPS → WABA_STABLE_TPS (40 → 73); high-throughput
 * numbers (1 000/s) use WABA_HIGH_START_TPS → WABA_HIGH_STABLE_TPS
 * (40 → 820). Same WABA_START_DURATION_SECONDS; null = warm-up off.
 */
export function warmupConfigForTier(
  tierRate: number,
  env: Record<string, string | undefined> = process.env
): WarmupConfig | null {
  const base = warmupConfig(env);
  if (!base || tierRate < HIGH_TIER_RATE) return base;
  return {
    startTps: num(
      env.WABA_HIGH_START_TPS,
      DEFAULT_HIGH_WARMUP.startTps,
      0.1,
      'WABA_HIGH_START_TPS'
    ),
    startSeconds: base.startSeconds,
    stableTps: num(
      env.WABA_HIGH_STABLE_TPS,
      DEFAULT_HIGH_WARMUP.stableTps,
      0.1,
      'WABA_HIGH_STABLE_TPS'
    ),
  };
}

/** The schedule: rate (msg/s) `elapsedS` seconds after the channel started. */
export function warmupRateAt(elapsedS: number, cfg: WarmupConfig): number {
  return elapsedS < cfg.startSeconds ? cfg.startTps : cfg.stableTps;
}

// ARGV: now (s), want, startTps, startSeconds, stableTps, ttl (s).
// KEYS[1] the (campaign, channel) hash, KEYS[2] the campaign's index set
// (same {campaign} hash tag, so both live in one cluster slot).
// Tokens earned across the switch are split exactly: start rate up to
// start + startSeconds, stable rate after. Times are float seconds; a
// caller clock slightly behind the last writer's is treated as "now =
// last" (NTP skew), one more than 2 s off is trusted instead.
const WARMUP_ACQUIRE_LUA = `
local now = tonumber(ARGV[1])
local want = tonumber(ARGV[2])
local startTps = tonumber(ARGV[3])
local startS = tonumber(ARGV[4])
local stableTps = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])
local h = redis.call('HMGET', KEYS[1], 'started', 'tokens', 'last')
local started = tonumber(h[1])
local tokens
local last
if not started then
  -- First send of this channel in this campaign: the clock starts now,
  -- and the first message goes immediately.
  started = now
  tokens = 1
  last = now
else
  tokens = tonumber(h[2]) or 0
  last = tonumber(h[3]) or now
  if now < last and last - now < 2 then now = last end
  local switchAt = started + startS
  local elapsed = now - last
  if elapsed < 0 then elapsed = 0 end
  local add
  if last >= switchAt then
    add = stableTps * elapsed
  elseif now <= switchAt then
    add = startTps * elapsed
  else
    add = startTps * (switchAt - last) + stableTps * (now - switchAt)
  end
  local rateNow = stableTps
  if now - started < startS then rateNow = startTps end
  local burst = math.max(1.5, rateNow / 100)
  tokens = math.min(burst, tokens + add)
end
local rate = stableTps
if now - started < startS then rate = startTps end
local granted = math.min(want, math.floor(tokens))
tokens = tokens - granted
local wait = 0
if granted < want then wait = (1 - tokens) / rate end
local phase = 'stable'
if rate == startTps and now - started < startS then phase = 'warmup' end
redis.call('HSET', KEYS[1], 'started', tostring(started), 'tokens', tostring(tokens),
  'last', tostring(now), 'phase', phase, 'start_tps', tostring(startTps),
  'stable_tps', tostring(stableTps))
redis.call('EXPIRE', KEYS[1], ttl)
redis.call('SADD', KEYS[2], KEYS[1])
redis.call('EXPIRE', KEYS[2], ttl)
return { granted, math.ceil(wait * 1000), tostring(rate), tostring(started) }
`;

// KEYS[1] the campaign's index set. Members are full key names.
const WARMUP_CLEAR_LUA = `
local members = redis.call('SMEMBERS', KEYS[1])
for _, k in ipairs(members) do redis.call('DEL', k) end
redis.call('DEL', KEYS[1])
return #members
`;

type WarmupRedis = Redis & {
  wacrmWarmupAcquire(
    key: string,
    index: string,
    now: number,
    want: number,
    startTps: number,
    startS: number,
    stableTps: number,
    ttl: number
  ): Promise<[number, number, string, string]>;
  wacrmWarmupClear(index: string): Promise<number>;
};

function withScripts(redis: Redis): WarmupRedis {
  const r = redis as WarmupRedis;
  if (typeof r.wacrmWarmupAcquire !== 'function') {
    redis.defineCommand('wacrmWarmupAcquire', {
      numberOfKeys: 2,
      lua: WARMUP_ACQUIRE_LUA,
    });
    redis.defineCommand('wacrmWarmupClear', {
      numberOfKeys: 1,
      lua: WARMUP_CLEAR_LUA,
    });
  }
  return r;
}

export const warmupKeys = (broadcastId: string, phoneNumberId: string) => ({
  state: `warmup:{${broadcastId}}:${phoneNumberId}`,
  index: `warmup:{${broadcastId}}:channels`,
});

export interface TryAcquire {
  granted: number;
  waitMs: number;
  rate: number;
  /** Channel start (ms epoch). */
  startedAt: number;
}

/** The same schedule in process memory (no Redis, or Redis down). */
export class LocalWarmupBucket {
  private started: number | null = null;
  private tokens = 0;
  private last = 0;

  constructor(private readonly cfg: WarmupConfig) {}

  tryAcquire(want: number, nowMs: number): TryAcquire {
    const now = nowMs / 1000;
    const { startTps, startSeconds: startS, stableTps } = this.cfg;
    if (this.started === null) {
      this.started = now;
      this.tokens = 1;
      this.last = now;
    } else {
      const t = Math.max(now, this.last);
      const switchAt = this.started + startS;
      const elapsed = t - this.last;
      const add =
        this.last >= switchAt
          ? stableTps * elapsed
          : t <= switchAt
            ? startTps * elapsed
            : startTps * (switchAt - this.last) + stableTps * (t - switchAt);
      const rateNow = t - this.started < startS ? startTps : stableTps;
      this.tokens = Math.min(Math.max(1.5, rateNow / 100), this.tokens + add);
      this.last = t;
    }
    const rate = warmupRateAt(now - this.started, this.cfg);
    const granted = Math.min(want, Math.floor(this.tokens));
    this.tokens -= granted;
    return {
      granted,
      waitMs: granted < want ? Math.ceil(((1 - this.tokens) / rate) * 1000) : 0,
      rate,
      startedAt: this.started * 1000,
    };
  }
}

const REDIS_RETRY_MS = 5_000;

/**
 * The warm-up limiter for one (campaign, channel). One queue and one
 * pump per instance; every slot comes from Redis, or — only while Redis
 * is unreachable — from the local bucket, never both at once.
 */
export class WarmupLimiter {
  private readonly redis: WarmupRedis | null;
  private readonly keys: { state: string; index: string };
  private readonly local: LocalWarmupBucket;
  private waiters: (() => void)[] = [];
  private pumping = false;
  private redisDownUntil = 0;
  startedAt: number | null = null;

  constructor(
    redis: Redis | null,
    broadcastId: string,
    phoneNumberId: string,
    private readonly cfg: WarmupConfig,
    private readonly clock: () => number = Date.now
  ) {
    this.redis = redis ? withScripts(redis) : null;
    this.keys = warmupKeys(broadcastId, phoneNumberId);
    this.local = new LocalWarmupBucket(cfg);
  }

  /** The warm-up rate right now (msg/s). */
  get currentRate(): number {
    if (this.startedAt === null) return this.cfg.startTps;
    return warmupRateAt((this.clock() - this.startedAt) / 1000, this.cfg);
  }

  get pending(): number {
    return this.waiters.length;
  }

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      void this.pump();
    });
  }

  private useLocal(): boolean {
    if (!this.redis) return true;
    const status = this.redis.status as string | undefined;
    if (status && status !== 'ready') return true;
    return this.clock() < this.redisDownUntil;
  }

  /** One grant request (exposed for tests). */
  async tryAcquire(want: number): Promise<TryAcquire> {
    const r = await this.rawAcquire(want);
    this.startedAt = r.startedAt;
    return r;
  }

  private async rawAcquire(want: number): Promise<TryAcquire> {
    const now = this.clock();
    if (this.useLocal()) return this.local.tryAcquire(want, now);
    try {
      const [g, w, rate, started] = await this.redis!.wacrmWarmupAcquire(
        this.keys.state,
        this.keys.index,
        now / 1000,
        want,
        this.cfg.startTps,
        this.cfg.startSeconds,
        this.cfg.stableTps,
        WARMUP_TTL_SECONDS
      );
      return {
        granted: Number(g),
        waitMs: Number(w),
        rate: Number(rate),
        startedAt: Number(started) * 1000,
      };
    } catch (err) {
      logRedisError(err);
      this.redisDownUntil = this.clock() + REDIS_RETRY_MS;
      return this.local.tryAcquire(want, now);
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length) {
        const r = await this.tryAcquire(this.waiters.length);
        for (const w of this.waiters.splice(0, r.granted)) w();
        if (this.waiters.length)
          await new Promise((res) => setTimeout(res, Math.max(1, r.waitMs)));
      }
    } finally {
      this.pumping = false;
    }
  }
}

// ── Registry ────────────────────────────────────────────────────

const g = globalThis as unknown as {
  __wacrmWarmupLimiters?: Map<string, WarmupLimiter>;
};

/**
 * The warm-up limiter for this campaign on this number, or null when the
 * warm-up is switched off (WABA_START_TPS=off).
 */
export function warmupLimiter(
  broadcastId: string,
  phoneNumberId: string,
  cfg: WarmupConfig | null = warmupConfig()
): WarmupLimiter | null {
  if (!cfg) return null;
  const map = (g.__wacrmWarmupLimiters ??= new Map());
  const key = `${broadcastId}:${phoneNumberId}`;
  let l = map.get(key);
  if (!l) {
    l = new WarmupLimiter(getRedis(), broadcastId, phoneNumberId, cfg);
    map.set(key, l);
  }
  return l;
}

/**
 * Forget a campaign's warm-up state everywhere (it paused, finished or
 * failed). Never throws.
 */
export async function clearCampaignWarmup(broadcastId: string): Promise<void> {
  const map = g.__wacrmWarmupLimiters;
  if (map)
    for (const k of [...map.keys()])
      if (k.startsWith(`${broadcastId}:`)) map.delete(k);
  const redis = getRedis();
  if (!redis) return;
  try {
    await withScripts(redis).wacrmWarmupClear(
      warmupKeys(broadcastId, '').index
    );
  } catch (err) {
    logRedisError(err);
  }
}

/** For tests. */
export function resetWarmupLimiters(): void {
  g.__wacrmWarmupLimiters?.clear();
}
