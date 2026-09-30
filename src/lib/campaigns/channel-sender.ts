// ============================================================
// ChannelSender — sends campaign templates through ONE WhatsApp number
// as fast as that number is allowed (80 msg/s standard tier, up to
// 1 000 msg/s high throughput) and never lets an error escape.
//
//   - pacing: the number's shared limiter (channel-limiter.ts — one
//     bucket per number across campaigns and, with Redis, across
//     workers), plus the campaign's own speed when it's below the tier;
//     slows on a throttle error, recovers gradually;
//   - concurrency: enough requests in flight to reach the rate at
//     Graph API latency, capped (Semaphore);
//   - HTTP: pooled keep-alive / HTTP/2 client, 20 s timeout per request;
//   - retries: throttles (up to 5) and transient errors (up to 3, with
//     exponential backoff + jitter); ambiguous failures (timeout after
//     sending) are never retried, so nobody gets a message twice;
//   - circuit breaker: 20 transient failures in a row pause the channel
//     for 30 s instead of hammering a failing endpoint.
//
// send() always resolves: { ok: true, messageId } or { ok: false, error }
// with the classified action for the caller (next template / re-route /
// mark failed).
// ============================================================

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { metaFetch } from '@/lib/whatsapp/meta-http';
import {
  isRecipientNotAllowedError,
  phoneVariants,
} from '@/lib/whatsapp/phone-utils';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';
import { classifySendError, type ClassifiedError } from './send-errors';
import type { SpeedEvent, SpeedEventInfo } from './speed-log-shared';
import { channelLimiter, type ChannelLimiter } from './channel-limiter';
import { AdaptiveRateLimiter, Semaphore, inFlightFor } from './rate-limiter';

export interface SendJob {
  phone: string;
  template: MessageTemplate;
  params: SendTimeParams;
}

export type SendResult =
  | {
      ok: true;
      messageId: string;
      messageStatus?: string | null;
      /** When the accepted request left (ms): what Meta's rate limit counts. */
      sentAt: number;
    }
  | { ok: false; error: ClassifiedError };

export interface ChannelSenderOptions {
  phoneNumberId: string;
  accessToken: string;
  /** Messages per second (already capped to the number's tier). */
  rate: number;
  /** The number's tier (80 or 1 000 msg/s) — its shared limit. */
  maxRate?: number;
  /** Injected for tests; defaults to the number's shared limiter. */
  limiter?: ChannelLimiter;
  /** Per-request events for the campaign speed log (speed-log.ts). */
  onEvent?: (e: SpeedEventInfo) => void;
  /**
   * This campaign's warm-up on this number (warmup-limiter.ts): 40/s for
   * the first seconds, then 73/s. Applied in front of the per-number
   * limiter, so the lower of the two wins.
   */
  warmup?: { acquire(): Promise<void>; readonly currentRate: number } | null;
  maxInFlight?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_THROTTLE_RETRIES = 5;
const MAX_TRANSIENT_RETRIES = 3;
const BREAKER_THRESHOLD = 20;
const BREAKER_PAUSE_MS = 30_000;

export interface ChannelSenderStats {
  sent: number;
  failed: number;
  throttled: number;
  retried: number;
  inFlight: number;
  rate: number;
}

export class ChannelSender {
  /** The number's limiter — shared with every sender on that number. */
  readonly limiter: ChannelLimiter;
  /** This campaign's own speed, when it's set below the number's tier. */
  private readonly campaignLimiter: AdaptiveRateLimiter | null;
  private readonly sem: Semaphore;
  private readonly sleep: (ms: number) => Promise<void>;
  private consecutiveTransient = 0;
  readonly stats = { sent: 0, failed: 0, throttled: 0, retried: 0 };

  constructor(private readonly opts: ChannelSenderOptions) {
    const tier = Math.max(opts.rate, opts.maxRate ?? opts.rate);
    this.limiter = opts.limiter ?? channelLimiter(opts.phoneNumberId, tier);
    this.campaignLimiter =
      opts.rate < tier ? new AdaptiveRateLimiter(opts.rate) : null;
    this.sem = new Semaphore(opts.maxInFlight ?? inFlightFor(opts.rate));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get maxInFlight(): number {
    return this.opts.maxInFlight ?? inFlightFor(this.opts.rate);
  }

  snapshot(): ChannelSenderStats {
    return {
      ...this.stats,
      inFlight: this.sem.inFlight,
      rate: Math.round(this.effectiveRate),
    };
  }

  /** What this sender may send right now: the lowest applicable limit. */
  get effectiveRate(): number {
    return Math.min(
      this.limiter.currentRate,
      this.campaignLimiter?.currentRate ?? Infinity,
      this.opts.warmup?.currentRate ?? Infinity
    );
  }

  private emit(type: SpeedEvent, at = Date.now()): void {
    if (!this.opts.onEvent) return;
    try {
      this.opts.onEvent({
        type,
        at,
        rate: this.effectiveRate,
        inFlight: this.sem.inFlight,
        maxInFlight: this.maxInFlight,
        tierRate: this.opts.maxRate ?? this.opts.rate,
        capRate: Math.min(
          this.opts.rate,
          this.opts.warmup?.currentRate ?? Infinity
        ),
      });
    } catch {
      // Logging must never affect sending.
    }
  }

  /**
   * Wait for a send slot (rate + concurrency) BEFORE picking a recipient,
   * so channels sharing a queue take work as fast as they can send it —
   * not as fast as they can grab it. Pass `{ reserved: true }` to the
   * following send(), or cancel() if there's nothing to send.
   */
  async reserve(): Promise<void> {
    await this.opts.warmup?.acquire();
    await this.campaignLimiter?.acquire();
    await this.limiter.acquire();
    await this.sem.acquire();
  }

  /** Give back a reserve() that won't be used. */
  cancel(): void {
    this.sem.release();
  }

  async send(
    job: SendJob,
    { reserved = false }: { reserved?: boolean } = {}
  ): Promise<SendResult> {
    let first = reserved;
    let throttles = 0;
    let transients = 0;
    for (;;) {
      const outcome = await this.attempt(job, first);
      first = false;
      if (outcome.ok) {
        this.consecutiveTransient = 0;
        this.stats.sent++;
        return outcome;
      }
      const { error } = outcome;

      if (error.action === 'throttle' && throttles < MAX_THROTTLE_RETRIES) {
        throttles++;
        this.stats.throttled++;
        this.limiter.penalize(error.retryAfterMs ?? 1000);
        continue;
      }
      if (error.action === 'retry' && transients < MAX_TRANSIENT_RETRIES) {
        transients++;
        this.stats.retried++;
        if (++this.consecutiveTransient >= BREAKER_THRESHOLD) {
          this.consecutiveTransient = 0;
          this.limiter.pause(BREAKER_PAUSE_MS);
        }
        const backoff = (error.retryAfterMs ?? 1000) * 2 ** (transients - 1);
        await this.sleep(backoff + Math.random() * 250);
        continue;
      }
      this.stats.failed++;
      return outcome;
    }
  }

  /** One paced, bounded request (with the sandbox phone-variant retry). */
  private async attempt(job: SendJob, reserved: boolean): Promise<SendResult> {
    if (!reserved) await this.reserve();
    try {
      let lastError: unknown = null;
      for (const to of phoneVariants(job.phone)) {
        const sentAt = Date.now();
        this.emit('sent', sentAt);
        try {
          const { messageId, messageStatus } = await sendTemplateMessage({
            phoneNumberId: this.opts.phoneNumberId,
            accessToken: this.opts.accessToken,
            to,
            templateName: job.template.name,
            language: job.template.language ?? 'en_US',
            template: job.template,
            messageParams: job.params,
            fetchImpl: this.opts.fetchImpl ?? metaFetch,
            timeoutMs: this.opts.timeoutMs ?? 20_000,
          });
          this.emit('accepted');
          return { ok: true, messageId, messageStatus, sentAt };
        } catch (err) {
          lastError = err;
          this.emit(
            classifySendError(err).action === 'throttle'
              ? 'throttled'
              : 'failed'
          );
          if (
            !isRecipientNotAllowedError(err instanceof Error ? err.message : '')
          )
            break;
        }
      }
      return { ok: false, error: classifySendError(lastError) };
    } catch (err) {
      // Anything unexpected (bug, builder error) — never let it escape.
      return { ok: false, error: classifySendError(err) };
    } finally {
      this.sem.release();
    }
  }
}
