import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendTemplateMessage = vi.fn();
const published: unknown[] = [];
vi.mock('@/lib/whatsapp/meta-api', async (orig) => {
  const actual = await orig<typeof import('@/lib/whatsapp/meta-api')>();
  return {
    ...actual,
    sendTemplateMessage: (...a: unknown[]) => sendTemplateMessage(...a),
  };
});
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => `plain:${s}`,
}));
vi.mock('@/lib/kafka/producers', () => ({
  publishCampaignSends: vi.fn(async (msgs: unknown[]) => {
    published.push(...msgs);
    return true;
  }),
  publishTemplateStatus: vi.fn(async () => false),
}));

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import { dispatchCampaignToKafka, handleCampaignSend } from './kafka-sender';
import { emitTemplateStatusLocal } from './template-status-bus';

// Minimal in-memory PostgREST stand-in (see advanced-runner.test.ts),
// plus `.or()` for the claim filter and `.gt()` for dispatch paging.
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    let op: 'select' | 'update' = 'select';
    let patch: Row = {};
    let head = false;
    let limitN = Infinity;
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => (tables[table] ??= []);
    const run = () => {
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === 'update')
        for (const r of hit) Object.assign(r, structuredClone(patch));
      const out = hit
        .slice(0, limitN)
        .map((r) =>
          table === 'broadcast_recipients'
            ? { ...r, contact: { phone: r.phone } }
            : { ...r }
        );
      if (head) return { data: null, count: hit.length, error: null };
      if (single) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };
    const b = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
      update: (p: Row) => ((op = 'update'), (patch = p), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, v: unknown[]) => (
        filters.push((r) => v.includes(r[c])),
        b
      ),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), b),
      or: (expr: string) => {
        const parts = expr.split(',').map((p) => p.split('.'));
        filters.push((r) =>
          parts.some(([c, o, ...rest]) => {
            const v = rest.join('.');
            if (o === 'is') return r[c] == null;
            if (o === 'lt') return r[c] != null && String(r[c]) < v;
            return false;
          })
        );
        return b;
      },
      order: () => b,
      limit: (n: number) => ((limitN = n), b),
      maybeSingle: () => ((single = true), b),
      single: () => ((single = true), b),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const tpl = (id: string, name: string, waba: string, meta: string) => ({
  id,
  account_id: 'acc',
  name,
  language: 'en_US',
  waba_id: waba,
  meta_template_id: meta,
  status: 'APPROVED',
  body_text: 'Hi {{1}}',
  category: 'Marketing',
});

let n = 0;
function setup(recipients = 4) {
  n++;
  const bId = `b${n}`;
  const tables: Record<string, Row[]> = {
    broadcasts: [
      {
        id: bId,
        account_id: 'acc',
        status: 'sending',
        kind: 'advanced',
        config: {
          version: 1,
          channel_ids: ['c1', 'c2'],
          templates: [
            { name: 'promo_a', language: 'en_US' },
            { name: 'promo_b', language: 'en_US' },
          ],
          phone_column: 'phone',
          name_column: null,
          mappings: {
            'promo_a:en_US': {
              body: { '1': { type: 'column', value: 'name' } },
            },
            'promo_b:en_US': {
              body: { '1': { type: 'static', value: 'friend' } },
            },
          },
          speed: 80,
        },
      },
    ],
    whatsapp_config: [
      {
        id: 'c1',
        account_id: 'acc',
        name: 'One',
        phone_number_id: 'p1',
        waba_id: 'w1',
        access_token: 't1',
      },
      {
        id: 'c2',
        account_id: 'acc',
        name: 'Two',
        phone_number_id: 'p2',
        waba_id: 'w2',
        access_token: 't2',
      },
    ],
    message_templates: [
      tpl('a1', 'promo_a', 'w1', 'm-a1'),
      tpl('b1', 'promo_b', 'w1', 'm-b1'),
      tpl('a2', 'promo_a', 'w2', 'm-a2'),
      tpl('b2', 'promo_b', 'w2', 'm-b2'),
    ],
    broadcast_recipients: Array.from({ length: recipients }, (_, i) => ({
      id: `${bId}-r${i}`,
      broadcast_id: bId,
      status: 'pending',
      claimed_at: null,
      phone: `91980000000${i}`,
      row_data: { __phone: `91980000000${i}`, name: `N${i}` },
    })),
  };
  return { tables, db: fakeDb(tables), bId };
}

const msg = (bId: string, i: number, channelId = 'c1', attempt = 0) => ({
  v: 1 as const,
  broadcastId: bId,
  recipientId: `${bId}-r${i}`,
  channelId,
  attempt,
});

beforeEach(() => {
  sendTemplateMessage.mockReset();
  published.length = 0;
});

describe('dispatchCampaignToKafka', () => {
  it('queues every pending recipient round-robin over the channels', async () => {
    const { db, bId, tables } = setup(5);
    const res = await dispatchCampaignToKafka(db, bId);
    expect(res).toEqual({ status: 'queued', count: 5 });
    const channels = (published as { channelId: string }[]).map(
      (m) => m.channelId
    );
    expect(channels).toEqual(['c1', 'c2', 'c1', 'c2', 'c1']);
    expect(
      (tables.broadcasts[0].config as { kafka_dispatched_at?: string })
        .kafka_dispatched_at
    ).toBeTruthy();
  });

  it('does not re-queue within the re-dispatch window unless forced', async () => {
    const { db, bId } = setup(2);
    await dispatchCampaignToKafka(db, bId);
    published.length = 0;
    expect(await dispatchCampaignToKafka(db, bId)).toEqual({
      status: 'skipped',
    });
    expect(await dispatchCampaignToKafka(db, bId, { force: true })).toEqual({
      status: 'queued',
      count: 2,
    });
  });
});

describe('handleCampaignSend', () => {
  it('claims, sends with the first template and stamps the row', async () => {
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' });
    const { db, bId, tables } = setup(1);
    expect(await handleCampaignSend(db, msg(bId, 0))).toBe('sent');
    const r = tables.broadcast_recipients[0];
    expect(r).toMatchObject({
      status: 'sent',
      whatsapp_config_id: 'c1',
      template_name: 'promo_a',
    });
    expect(sendTemplateMessage.mock.calls[0][0].messageParams.body).toEqual([
      'N0',
    ]);
    // Last recipient done → campaign settled.
    expect(tables.broadcasts[0].status).toBe('sent');
  });

  it('a redelivered message does not send twice', async () => {
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' });
    const { db, bId } = setup(2);
    await handleCampaignSend(db, msg(bId, 0));
    expect(await handleCampaignSend(db, msg(bId, 0))).toBe('skipped');
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next template when Meta pauses one', async () => {
    sendTemplateMessage.mockImplementation(
      async (a: { templateName: string }) => {
        if (a.templateName === 'promo_a')
          throw new MetaApiError('Template is paused', {
            code: 132015,
            httpStatus: 400,
          });
        return { messageId: 'wamid.b' };
      }
    );
    const { db, bId, tables } = setup(2);
    expect(await handleCampaignSend(db, msg(bId, 0))).toBe('sent');
    expect(tables.broadcast_recipients[0]).toMatchObject({
      status: 'sent',
      template_name: 'promo_b',
    });
    const exhausted = (
      tables.broadcasts[0].config as {
        exhausted: Record<string, Record<string, string>>;
      }
    ).exhausted;
    expect(Object.keys(exhausted.c1)).toEqual(['promo_a:en_US']);
    // Next recipient on that channel goes straight to promo_b.
    sendTemplateMessage.mockClear();
    await handleCampaignSend(db, msg(bId, 1));
    expect(
      sendTemplateMessage.mock.calls.map((c) => c[0].templateName)
    ).toEqual(['promo_b']);
  });

  it('re-routes to another channel when this one is blocked', async () => {
    sendTemplateMessage.mockRejectedValue(
      new MetaApiError('Invalid token', { code: 190, httpStatus: 401 })
    );
    const { db, bId, tables } = setup(1);
    expect(await handleCampaignSend(db, msg(bId, 0, 'c1'))).toBe('rerouted');
    expect(published).toEqual([
      expect.objectContaining({ channelId: 'c2', attempt: 1 }),
    ]);
    // Claim released so the other channel's worker can take it.
    expect(tables.broadcast_recipients[0]).toMatchObject({
      status: 'pending',
      claimed_at: null,
    });
  });

  it('drops a template the moment a PAUSED status event arrives', async () => {
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.x' });
    const { db, bId } = setup(2);
    await handleCampaignSend(db, msg(bId, 0, 'c2')); // warms the cache
    emitTemplateStatusLocal({
      v: 1,
      wabaId: 'w2',
      templateId: 'm-a2',
      name: 'promo_a',
      language: 'en_US',
      event: 'PAUSED',
      reason: null,
      at: new Date().toISOString(),
    });
    sendTemplateMessage.mockClear();
    await handleCampaignSend(db, msg(bId, 1, 'c2'));
    expect(
      sendTemplateMessage.mock.calls.map((c) => c[0].templateName)
    ).toEqual(['promo_b']);
  });

  it('skips campaigns that are no longer sending', async () => {
    const { db, bId, tables } = setup(1);
    tables.broadcasts[0].status = 'failed';
    expect(await handleCampaignSend(db, msg(bId, 0))).toBe('skipped');
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('templateStatusEvent', () => {
  it('reads Meta’s status-update value', async () => {
    const { templateStatusEvent } = await import('./template-status-bus');
    expect(
      templateStatusEvent('w1', {
        event: 'paused',
        message_template_id: 123,
        message_template_name: 'promo_a',
        message_template_language: 'en_US',
        reason: 'LOW_QUALITY',
      })
    ).toMatchObject({
      wabaId: 'w1',
      templateId: '123',
      name: 'promo_a',
      event: 'PAUSED',
      reason: 'LOW_QUALITY',
    });
    expect(templateStatusEvent('w1', {})).toBeNull();
  });
});

describe('delivery settings (Kafka worker)', () => {
  it('stop on Meta API error stops the campaign for good; queued messages are not sent', async () => {
    sendTemplateMessage.mockImplementation(async (a: { to: string }) => {
      if (a.to.endsWith('0')) {
        throw new MetaApiError('(#135000) Generic user error', {
          code: 135000,
          httpStatus: 400,
        });
      }
      return { messageId: 'wamid.ok' };
    });
    const { db, bId, tables } = setup(3);
    (tables.broadcasts[0].config as Record<string, unknown>).delivery = {
      stop_on_meta_error: true,
    };

    expect(await handleCampaignSend(db, msg(bId, 0))).toBe('failed');
    expect(tables.broadcasts[0].status).toBe('failed');
    expect(
      String((tables.broadcasts[0].config as Record<string, unknown>).stopped_reason)
    ).toContain('135000');
    // The triggering recipient keeps its real Meta error…
    expect(tables.broadcast_recipients[0].error_message).toContain('[135000]');
    // …and the rest are closed as failed, so nothing can resume them.
    expect(tables.broadcast_recipients[1]).toMatchObject({ status: 'failed' });
    expect(String(tables.broadcast_recipients[1].error_message)).toContain(
      'Campaign stopped'
    );
    sendTemplateMessage.mockClear();
    expect(await handleCampaignSend(db, msg(bId, 1))).toBe('skipped');
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('stop on Meta API error off: the job fails and the next one still sends', async () => {
    sendTemplateMessage.mockImplementation(async (a: { to: string }) => {
      if (a.to.endsWith('0')) {
        throw new MetaApiError('(#135000) Generic user error', {
          code: 135000,
          httpStatus: 400,
        });
      }
      return { messageId: 'wamid.ok' };
    });
    const { db, bId, tables } = setup(3);
    expect(await handleCampaignSend(db, msg(bId, 0))).toBe('failed');
    expect(await handleCampaignSend(db, msg(bId, 1))).toBe('sent');
    expect(tables.broadcasts[0].status).toBe('sending');
  });

  it('quality hold ON: the held message stays sent; the campaign stops for good', async () => {
    sendTemplateMessage.mockImplementation(async () => ({
      messageId: 'wamid.held',
      messageStatus: 'held_for_quality_assessment',
    }));
    const { db, bId, tables } = setup(3);
    (tables.broadcasts[0].config as Record<string, unknown>).delivery = {
      pause_on_quality_hold: true,
    };

    expect(await handleCampaignSend(db, msg(bId, 0))).toBe('sent');
    // Written after the stop closed the others — still recorded as sent.
    expect(tables.broadcast_recipients[0]).toMatchObject({
      status: 'sent',
      meta_message_status: 'held_for_quality_assessment',
    });
    expect(
      String((tables.broadcasts[0].config as Record<string, unknown>).stopped_reason)
    ).toContain('quality assessment');
    expect(tables.broadcast_recipients.slice(1).map((r) => r.status)).toEqual([
      'failed',
      'failed',
    ]);
    // One went out → settles as sent (Completed), still not resumable.
    expect(tables.broadcasts[0].status).toBe('sent');
  });
});
