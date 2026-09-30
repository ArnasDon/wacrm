import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { MetaApiError, sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { classifySendError } from './send-errors';
import { claimCampaignStart } from './start-gate';

const json = (status: number, body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
  );

const send = (fetchImpl: typeof fetch) =>
  sendTemplateMessage({
    phoneNumberId: 'p',
    accessToken: 't',
    to: '919800000001',
    templateName: 'promo',
    fetchImpl,
  });

describe('reading Meta send responses', () => {
  it('held_for_quality_assessment + id is a successful submission, with its status', async () => {
    const res = await send(
      json(200, {
        messaging_product: 'whatsapp',
        messages: [
          { id: 'wamid.X', message_status: 'held_for_quality_assessment' },
        ],
      }) as unknown as typeof fetch
    );
    expect(res).toEqual({
      messageId: 'wamid.X',
      messageStatus: 'held_for_quality_assessment',
    });
  });

  it('a response that merely has a `message` field is not an error', async () => {
    const res = await send(
      json(200, {
        message: 'ok',
        messages: [{ id: 'wamid.Y' }],
      }) as unknown as typeof fetch
    );
    expect(res.messageId).toBe('wamid.Y');
  });

  it('error.code 135000 is a Meta API error (HTTP error response)', async () => {
    const err = await send(
      json(400, {
        error: {
          message: '(#135000) Generic user error',
          code: 135000,
          type: 'OAuthException',
        },
      }) as unknown as typeof fetch
    ).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.code).toBe(135000);
    expect(classifySendError(err)).toMatchObject({
      action: 'recipient',
      code: 135000,
      fromMeta: true,
    });
  });

  it('error.code 135000 in a 200 body is still a Meta API error', async () => {
    const err = await send(
      json(200, {
        error: { message: '(#135000) Generic user error', code: 135000 },
      }) as unknown as typeof fetch
    ).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.code).toBe(135000);
  });

  it('timeouts / our own validation are not "Meta API errors"', () => {
    const timeout = Object.assign(
      new Error('The operation was aborted due to timeout'),
      { name: 'TimeoutError' }
    );
    expect(classifySendError(timeout)).toMatchObject({
      action: 'unknown',
      fromMeta: false,
    });
    expect(
      classifySendError(new Error('Variable {{1}} is empty'))
    ).toMatchObject({ fromMeta: false });
  });
});

describe('claimCampaignStart (campaign interval)', () => {
  afterEach(() => vi.useRealTimers());

  function db(
    config: Record<string, unknown>,
    waits: (number | { error: string })[]
  ) {
    const updates: Record<string, unknown>[] = [];
    const rpc = vi.fn(async () => {
      const next = waits.shift() ?? 0;
      return typeof next === 'number'
        ? { data: next, error: null }
        : { data: null, error: { message: next.error } };
    });
    const from = () => {
      const b = {
        select: () => b,
        update: (p: Record<string, unknown>) => (updates.push(p), b),
        eq: () => b,
        maybeSingle: async () => ({ data: { account_id: 'acc', config } }),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(r),
      };
      return b;
    };
    return { client: { rpc, from } as unknown as SupabaseClient, rpc, updates };
  }

  it('the first campaign starts immediately and records its start', async () => {
    const { client, rpc, updates } = db(
      { delivery: { interval_seconds: 30 } },
      [0]
    );
    expect(await claimCampaignStart(client, 'b1', Date.now() + 60_000)).toBe(
      true
    );
    expect(rpc).toHaveBeenCalledWith('claim_campaign_start', {
      p_account_id: 'acc',
      p_interval_seconds: 30,
      p_enforce: true,
    });
    expect(
      updates.some((u) => (u.config as { started_at?: string })?.started_at)
    ).toBe(true);
  });

  it('a later campaign waits its turn, then starts', async () => {
    vi.useFakeTimers();
    const { client, rpc } = db({ delivery: { interval_seconds: 30 } }, [12, 0]);
    const p = claimCampaignStart(client, 'b2', Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(12_100);
    expect(await p).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('yields when the wait would pass the deadline (a later pass retries)', async () => {
    const { client } = db({ delivery: { interval_seconds: 30 } }, [25]);
    expect(await claimCampaignStart(client, 'b3', Date.now() + 5_000)).toBe(
      false
    );
  });

  it('interval off still records the start but never waits', async () => {
    const { client, rpc } = db({ delivery: { interval_seconds: 0 } }, [0]);
    expect(await claimCampaignStart(client, 'b4', Date.now())).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'claim_campaign_start',
      expect.objectContaining({ p_enforce: false })
    );
  });

  it('an already-started campaign (resume / next pass) is not gated again', async () => {
    const { client, rpc } = db(
      {
        started_at: '2026-01-01T00:00:00Z',
        delivery: { interval_seconds: 30 },
      },
      []
    );
    expect(await claimCampaignStart(client, 'b5', Date.now())).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('missing migration → starts rather than blocking', async () => {
    const { client } = db({ delivery: { interval_seconds: 30 } }, [
      { error: 'function claim_campaign_start does not exist' },
    ]);
    expect(await claimCampaignStart(client, 'b6', Date.now())).toBe(true);
  });
});
