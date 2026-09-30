import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { classifySendError } from './send-errors';
import {
  AdaptiveRateLimiter,
  Semaphore,
  channelMaxRate,
  effectiveRate,
  inFlightFor,
} from './rate-limiter';
import { ChannelSender } from './channel-sender';
import { resetChannelLimiters } from './channel-limiter';
import { RecipientResultWriter } from './result-writer';
import type { MessageTemplate } from '@/types';

const meta = (code: number, httpStatus = 400, message = 'err') =>
  new MetaApiError(message, { code, httpStatus });
const netErr = (code: string) =>
  Object.assign(new TypeError('fetch failed'), { cause: { code } });

describe('classifySendError', () => {
  it.each([
    [meta(130429), 'throttle'],
    [meta(131048), 'throttle'],
    [meta(80007), 'throttle'],
    [meta(4), 'throttle'],
    [new MetaApiError('slow down', { httpStatus: 429 }), 'throttle'],
    [meta(132015), 'template'],
    [meta(132016), 'template'],
    [meta(132001), 'template'],
    [meta(190, 401), 'channel'],
    [meta(368), 'channel'],
    [meta(131031), 'channel'],
    [meta(131000, 500), 'retry'],
    [meta(2, 503), 'retry'],
    [new MetaApiError('bad gateway', { httpStatus: 502 }), 'retry'],
    [meta(131026), 'recipient'],
    [meta(131049), 'recipient'],
    [meta(131047), 'recipient'],
    [meta(100), 'recipient'],
    [netErr('ECONNREFUSED'), 'retry'],
    [netErr('ENOTFOUND'), 'retry'],
    [netErr('ECONNRESET'), 'unknown'],
    [
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
      'unknown',
    ],
    [new Error('Variable {{1}} is empty for this recipient'), 'recipient'],
  ])('%s → %s', (err, action) => {
    expect(classifySendError(err).action).toBe(action);
  });

  it('keeps the "[code] message" text the Analytics tab groups by', () => {
    expect(classifySendError(meta(131049, 400, 'Marketing limit')).text).toBe(
      '[131049] Marketing limit'
    );
  });
});

describe('AdaptiveRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('releases at most `rate` per second', async () => {
    const limiter = new AdaptiveRateLimiter(100);
    let done = 0;
    for (let i = 0; i < 1000; i++) void limiter.acquire().then(() => done++);
    await vi.advanceTimersByTimeAsync(1000);
    // ~100 in the first second (+ the small initial burst).
    expect(done).toBeGreaterThanOrEqual(95);
    expect(done).toBeLessThanOrEqual(110);
  });

  it('slows and pauses on a throttle (once per burst), then recovers', async () => {
    const limiter = new AdaptiveRateLimiter(100);
    limiter.penalize(2000);
    limiter.penalize(2000); // same burst — ignored
    limiter.penalize(2000);
    // Starts with headroom (97.5 of 100); a throttle cuts 10 %.
    expect(limiter.currentRate).toBeCloseTo(87.75);
    let done = 0;
    for (let i = 0; i < 50; i++) void limiter.acquire().then(() => done++);
    await vi.advanceTimersByTimeAsync(90);
    expect(done).toBe(0); // brief pause
    for (let s = 0; s < 5; s++) {
      await vi.advanceTimersByTimeAsync(1_000);
      void limiter.currentRate; // the pump refills this often in real use
    }
    // Quickly back to just under where Meta throttled (97.5 % of 97.5)…
    expect(limiter.currentRate).toBeGreaterThan(95);
    for (let s = 0; s < 60; s++) {
      await vi.advanceTimersByTimeAsync(1_000);
      void limiter.currentRate;
    }
    // …and a minute later still below it: no walking back into 130429.
    expect(limiter.currentRate).toBeLessThan(97.5);
  });

  it('starts with headroom and only creeps up to the tier', async () => {
    const limiter = new AdaptiveRateLimiter(80);
    expect(limiter.currentRate).toBe(78); // 97.5 % of 80
    for (let s = 0; s < 30; s++) {
      await vi.advanceTimersByTimeAsync(1_000);
      void limiter.currentRate;
    }
    expect(limiter.currentRate).toBeLessThan(78.5); // no rush to 80
    for (let s = 0; s < 300; s++) {
      await vi.advanceTimersByTimeAsync(1_000);
      void limiter.currentRate;
    }
    expect(limiter.currentRate).toBe(80); // found the full tier eventually
  });

  it('after a throttle, holds just under that point', async () => {
    const limiter = new AdaptiveRateLimiter(80);
    limiter.penalize(); // Meta said too fast at 78/s
    expect(limiter.currentRate).toBeCloseTo(70.2);
    for (let s = 0; s < 120; s++) {
      await vi.advanceTimersByTimeAsync(1_000);
      void limiter.currentRate;
    }
    // ~97.5 % of 78 = 76, and not back at 78 two minutes later.
    expect(limiter.currentRate).toBeGreaterThanOrEqual(76);
    expect(limiter.currentRate).toBeLessThan(78);
  });
});

describe('Semaphore / tiers', () => {
  it('never exceeds its limit', async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        await sem.acquire();
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        sem.release();
      })
    );
    expect(peak).toBe(3);
  });

  it('maps Meta throughput tiers and sizes concurrency', () => {
    expect(channelMaxRate('HIGH')).toBe(1000);
    expect(channelMaxRate('STANDARD')).toBe(80);
    expect(channelMaxRate(null)).toBe(80);
    expect(inFlightFor(80)).toBe(200);
    expect(inFlightFor(1000)).toBe(2500);
    expect(effectiveRate(80, null)).toBe(80);
    expect(effectiveRate(1000, null)).toBe(80);
    expect(effectiveRate(1000, 'HIGH')).toBe(1000);
  });
});

describe('ChannelSender', () => {
  const template = {
    name: 't',
    language: 'en_US',
    body_text: 'Hi',
  } as MessageTemplate;
  const job = { phone: '919800000001', template, params: {} };
  const sender = () =>
    new ChannelSender({
      phoneNumberId: 'p',
      accessToken: 'x',
      rate: 1000,
      sleep: async () => {},
    });

  beforeEach(() => {
    sendTemplateMessage.mockReset();
    resetChannelLimiters();
  });

  it('retries a throttle and succeeds', async () => {
    sendTemplateMessage
      .mockRejectedValueOnce(meta(130429))
      .mockResolvedValueOnce({ messageId: 'w1' });
    const s = sender();
    s.limiter.penalize = vi.fn(); // don't actually wait
    expect(await s.send(job)).toMatchObject({ ok: true, messageId: 'w1' });
    expect(s.limiter.penalize).toHaveBeenCalledOnce();
  });

  it('retries transient errors up to 3 times, then gives up', async () => {
    sendTemplateMessage.mockRejectedValue(meta(131000, 500));
    const res = await sender().send(job);
    expect(res).toMatchObject({ ok: false, error: { action: 'retry' } });
    expect(sendTemplateMessage).toHaveBeenCalledTimes(4);
  });

  it('never retries an ambiguous failure (could double-send)', async () => {
    sendTemplateMessage.mockRejectedValue(netErr('ECONNRESET'));
    const res = await sender().send(job);
    expect(res).toMatchObject({ ok: false, error: { action: 'unknown' } });
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('returns template / channel errors to the caller without retrying', async () => {
    sendTemplateMessage.mockRejectedValue(meta(132015));
    expect(await sender().send(job)).toMatchObject({
      ok: false,
      error: { action: 'template' },
    });
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('never throws, even on an unexpected crash', async () => {
    sendTemplateMessage.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(sender().send(job)).resolves.toMatchObject({ ok: false });
  });

  it('keeps concurrency within the in-flight cap under load', async () => {
    let active = 0;
    let peak = 0;
    sendTemplateMessage.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { messageId: 'w' };
    });
    const s = new ChannelSender({
      phoneNumberId: 'p',
      accessToken: 'x',
      rate: 1000,
      maxInFlight: 10,
    });
    const results = await Promise.all(
      Array.from({ length: 100 }, () => s.send(job))
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBeLessThanOrEqual(10);
  });
});

describe('RecipientResultWriter', () => {
  it('writes a batch through the RPC in one call', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const w = new RecipientResultWriter({ rpc } as unknown as SupabaseClient);
    for (let i = 0; i < 3; i++) await w.record({ id: `r${i}`, status: 'sent' });
    await w.flush();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('apply_recipient_results', {
      p_rows: expect.arrayContaining([expect.objectContaining({ id: 'r0' })]),
    });
  });

  it('falls back to per-row updates when the function is missing', async () => {
    const eq2 = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: () => ({ eq: eq2 }) }));
    const db = {
      rpc: vi.fn(async () => ({
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.apply_recipient_results',
        },
      })),
      from: () => ({ update }),
    } as unknown as SupabaseClient;
    const w = new RecipientResultWriter(db);
    await w.record({ id: 'r1', status: 'failed', error_message: 'x' });
    await w.flush();
    expect(update).toHaveBeenCalledWith({
      status: 'failed',
      error_message: 'x',
    });
  });

  it('keeps rows and retries when the database is briefly down', async () => {
    vi.useFakeTimers();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        error: { code: '08006', message: 'connection failure' },
      })
      .mockResolvedValue({ error: null });
    const w = new RecipientResultWriter({ rpc } as unknown as SupabaseClient);
    await w.record({ id: 'r1', status: 'sent' });
    const flushed = w.flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flushed;
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(w.size).toBe(0);
    vi.useRealTimers();
  });
});
