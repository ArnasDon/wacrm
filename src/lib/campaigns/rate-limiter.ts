// ============================================================
// Per-channel pacing for campaign sends.
//
// AdaptiveRateLimiter — a token bucket that hands out send slots at
//   `rate` per second, FIFO, from ONE timer (hundreds of waiting sends
//   don't each spin their own). When Meta throttles (130429 etc.) the
//   rate drops 10 % and sending pauses for a moment; it then climbs
//   back fast to just under where it was throttled and probes above it
//   slowly, so a channel settles right at whatever Meta actually allows
//   instead of sawing far below it.
//
// Semaphore — caps requests in flight, so a slow Graph API can't pile
//   up unbounded sockets / memory.
// ============================================================

/**
 * Pace as a share of the limit it runs under: requests reach Meta a bit
 * bunched (network, HTTP/2), so running at exactly 80/s trips 130429 —
 * Meta was seen throttling at ~79.3/s. 97.5 % (78/s of 80, 975/s of
 * 1 000) keeps clear of it.
 */
export const LIMITER_HEADROOM = 0.975;
/**
 * How fast the pace probes upward past that, per second, as a share of
 * the tier: 0.0001 → from 97.5 % to 100 % in ~250 s. Slow on purpose —
 * climbing back quickly just walks into the next 130429.
 */
export const LIMITER_PROBE = 0.0001;

export class AdaptiveRateLimiter {
  private rate: number;
  private tokens = 0;
  private last: number;
  private pausedUntil = 0;
  private lastPenalty = -Infinity;
  /** Rate at which Meta last throttled us (Infinity = never). */
  private ceiling = Infinity;
  private waiters: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private maxRate: number,
    private readonly now: () => number = Date.now
  ) {
    this.maxRate = Math.max(1, maxRate);
    // The max is Meta's hard limit for the number: start just under it and
    // probe up, instead of opening with a burst of 130429s.
    this.ceiling = this.maxRate;
    this.rate = this.maxRate * LIMITER_HEADROOM;
    this.last = now();
  }

  /** Current sends per second (drops on throttle, recovers over time). */
  get currentRate(): number {
    this.refill();
    return this.rate;
  }

  get pending(): number {
    return this.waiters.length;
  }

  setMaxRate(maxRate: number): void {
    const next = Math.max(1, maxRate);
    if (next === this.maxRate) return;
    // A higher tier (e.g. upgraded to 1 000/s) is a new known limit.
    if (next > this.maxRate) this.ceiling = next;
    this.maxRate = next;
    this.rate = Math.min(this.rate, this.maxRate);
  }

  /** Resolves when this caller may send. */
  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.pump();
    });
  }

  /**
   * Meta said slow down: cut the rate by 10 % and hold off briefly.
   * Throttle replies arrive in bursts (every in-flight request gets one),
   * so only the first within a pause counts — otherwise one burst would
   * collapse the rate to nothing.
   */
  penalize(pauseMs = 1000): void {
    const now = this.now();
    const hold = Math.min(pauseMs, 100);
    if (now < this.lastPenalty + Math.max(hold, 500)) return;
    this.lastPenalty = now;
    // Remember where it broke; drop well below it. The rate itself does
    // the work — the pause only lets in-flight requests settle.
    this.ceiling = this.rate;
    this.rate = Math.max(1, this.rate * 0.9);
    this.tokens = 0;
    this.pausedUntil = Math.max(this.pausedUntil, now + hold);
    this.pump();
  }

  /** Stop handing out slots for a while (circuit breaker). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
    this.pump();
  }

  private refill(): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    if (now < this.pausedUntil) return;
    // Recover towards the max, then earn tokens; a small burst (50 ms of
    // traffic) smooths timer jitter without spiking.
    // Climb fast back to just under where Meta last throttled
    // (LIMITER_HEADROOM of it), then probe above very slowly
    // (LIMITER_PROBE) — each throttle costs a burst of rejected requests,
    // so holding just below the limit sends more than sawing through it.
    // The remembered ceiling creeps up as slowly, so a limit that was
    // lifted is found again.
    const target = this.ceiling * LIMITER_HEADROOM;
    this.rate = Math.min(
      this.maxRate,
      this.rate < target
        ? Math.min(target, this.rate + this.maxRate * 0.2 * elapsed)
        : this.rate + this.maxRate * LIMITER_PROBE * elapsed
    );
    if (this.ceiling !== Infinity) {
      this.ceiling = Math.min(
        this.maxRate * 2,
        this.ceiling + this.maxRate * LIMITER_PROBE * elapsed
      );
    }
    // Small burst: 1.5 slots absorbs timer lateness (a 12.5 ms wait fires
    // at 13–14 ms) without letting a 1 s window run much over `rate`.
    const burst = Math.max(1.5, this.rate / 100);
    this.tokens = Math.min(burst, this.tokens + this.rate * elapsed);
  }

  private pump(): void {
    if (this.timer) return;
    this.refill();
    while (
      this.waiters.length &&
      this.tokens >= 1 &&
      this.now() >= this.pausedUntil
    ) {
      this.tokens -= 1;
      this.waiters.shift()!();
    }
    if (!this.waiters.length) return;
    const now = this.now();
    const wait =
      now < this.pausedUntil
        ? this.pausedUntil - now
        : Math.ceil(((1 - this.tokens) / this.rate) * 1000);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.pump();
      },
      Math.max(1, wait)
    );
  }
}

export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  get inFlight(): number {
    return this.active;
  }

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    // The releasing caller hands its slot over directly (no gap in which
    // a newcomer could jump the queue and exceed the limit).
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

/**
 * The rate a channel actually sends at: the campaign speed, capped at the
 * number's tier (80 or 1 000 msg/s). No headroom below the tier — if Meta
 * throttles anyway, the limiter backs off and climbs back on its own.
 */
export function effectiveRate(
  speed: number,
  throughputLevel: string | null | undefined
): number {
  return Math.max(1, Math.min(speed, channelMaxRate(throughputLevel)));
}

/** Meta's per-number throughput tier → max messages / second. */
export function channelMaxRate(
  throughputLevel: string | null | undefined
): number {
  return (throughputLevel ?? '').toUpperCase() === 'HIGH' ? 1000 : 80;
}

/**
 * Seconds of Graph API latency the concurrency is sized for. Meta usually
 * answers in 0.3–1.5 s (region, template media, load); sending at `rate`
 * needs rate × latency requests open at once (Little's law). Sized for
 * the slow end so a slow Meta doesn't cap the rate — the rate limiter,
 * not the in-flight cap, is what paces sends.
 */
const LATENCY_BUDGET_S = 2.5;

/** Concurrent requests needed to sustain `rate` at Graph API latency. */
export function inFlightFor(rate: number): number {
  return Math.min(2500, Math.max(8, Math.ceil(rate * LATENCY_BUDGET_S)));
}
