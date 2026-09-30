import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendTemplateMessage = vi.fn();
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

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import { runAdvancedCampaign } from './advanced-runner';
import { resetChannelLimiters } from './channel-limiter';
import { resetWarmupLimiters } from './warmup-limiter';

// These tests are about routing and outcomes, not pacing: no warm-up.
process.env.WABA_START_TPS = 'off';

// ------------------------------------------------------------
// Tiny in-memory PostgREST stand-in: enough of the builder for the
// runner (select / update / eq / in / or / order / limit / single,
// count+head) over plain arrays.
// ------------------------------------------------------------
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
      const withJoins = hit
        .slice(0, limitN)
        .map((r) =>
          table === 'broadcast_recipients'
            ? { ...r, contact: { phone: r.phone } }
            : { ...r }
        );
      if (head) return { data: null, count: hit.length, error: null };
      if (single) return { data: withJoins[0] ?? null, error: null };
      return { data: withJoins, error: null };
    };

    const b = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        head = !!opts?.head;
        return b;
      },
      update: (p: Row) => {
        op = 'update';
        patch = p;
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, v: unknown[]) => (
        filters.push((r) => v.includes(r[c])),
        b
      ),
      or: () => b,
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

const tpl = (id: string, name: string, waba: string) => ({
  id,
  account_id: 'acc',
  name,
  language: 'en_US',
  waba_id: waba,
  status: 'APPROVED',
  body_text: 'Hi {{1}}',
  category: 'Marketing',
});

function setup(recipients: number) {
  const tables: Record<string, Row[]> = {
    broadcasts: [
      {
        id: 'b1',
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
          name_column: 'name',
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
      tpl('a1', 'promo_a', 'w1'),
      tpl('b1t', 'promo_b', 'w1'),
      tpl('a2', 'promo_a', 'w2'),
      tpl('b2', 'promo_b', 'w2'),
    ],
    broadcast_recipients: Array.from({ length: recipients }, (_, i) => ({
      id: `r${i}`,
      broadcast_id: 'b1',
      status: 'pending',
      phone: `9198000000${String(i).padStart(2, '0')}`,
      row_data: {
        __phone: `9198000000${String(i).padStart(2, '0')}`,
        name: `N${i}`,
      },
    })),
  };
  return { tables, db: fakeDb(tables) };
}

let seq = 0;
beforeEach(() => {
  sendTemplateMessage.mockReset();
  resetChannelLimiters();
  resetWarmupLimiters();
  seq = 0;
});

describe('runAdvancedCampaign', () => {
  it('splits recipients across channels and finishes', async () => {
    sendTemplateMessage.mockImplementation(async () => ({
      messageId: `wamid.${seq++}`,
    }));
    const { tables, db } = setup(20);

    const outcome = await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 });

    expect(outcome).toBe('finished');
    const recs = tables.broadcast_recipients;
    expect(recs.every((r) => r.status === 'sent')).toBe(true);
    const byChannel = new Set(recs.map((r) => r.whatsapp_config_id));
    expect(byChannel).toEqual(new Set(['c1', 'c2']));
    expect(recs.every((r) => r.template_name === 'promo_a')).toBe(true);
    expect(tables.broadcasts[0].status).toBe('sent');
    // Variables resolved per template from the CSV row.
    expect(sendTemplateMessage.mock.calls[0][0].messageParams.body[0]).toMatch(
      /^N\d+$/
    );
  });

  it('moves a channel to the next template when Meta pauses one', async () => {
    sendTemplateMessage.mockImplementation(
      async (args: { phoneNumberId: string; templateName: string }) => {
        if (args.phoneNumberId === 'p1' && args.templateName === 'promo_a') {
          throw new MetaApiError('Template is paused', {
            code: 132015,
            httpStatus: 400,
          });
        }
        return { messageId: `wamid.${seq++}` };
      }
    );
    const { tables, db } = setup(12);

    const outcome = await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 });

    expect(outcome).toBe('finished');
    const recs = tables.broadcast_recipients;
    // Nobody failed: the bounced recipients went out on promo_b.
    expect(recs.filter((r) => r.status === 'failed')).toHaveLength(0);
    const c1 = recs.filter((r) => r.whatsapp_config_id === 'c1');
    expect(c1.every((r) => r.template_name === 'promo_b')).toBe(true);
    const cfg = tables.broadcasts[0].config as {
      exhausted: Record<string, Record<string, string>>;
    };
    expect(Object.keys(cfg.exhausted.c1)).toEqual(['promo_a:en_US']);
    expect(cfg.exhausted.c2).toBeUndefined();
    // With the second template, promo_b gets the static value.
    const b = sendTemplateMessage.mock.calls.find(
      (c) => c[0].templateName === 'promo_b'
    )!;
    expect(b[0].messageParams.body).toEqual(['friend']);
  });

  it('fails the rest with a reason when every template is paused everywhere', async () => {
    sendTemplateMessage.mockRejectedValue(
      new MetaApiError('Template is disabled', {
        code: 132016,
        httpStatus: 400,
      })
    );
    const { tables, db } = setup(5);

    const outcome = await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 });

    expect(outcome).toBe('finished');
    const recs = tables.broadcast_recipients;
    expect(recs.every((r) => r.status === 'failed')).toBe(true);
    expect(String(recs[0].error_message)).toContain('No usable template left');
    expect(tables.broadcasts[0].status).toBe('failed');
  });

  it('records a recipient-level error without switching templates', async () => {
    sendTemplateMessage.mockImplementation(async (args: { to: string }) => {
      if (args.to.endsWith('03')) {
        throw new MetaApiError('Message undeliverable', {
          code: 131026,
          httpStatus: 400,
        });
      }
      return { messageId: `wamid.${seq++}` };
    });
    const { tables, db } = setup(6);

    await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 });

    const failed = tables.broadcast_recipients.filter(
      (r) => r.status === 'failed'
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].error_message).toBe('[131026] Message undeliverable');
    const sent = tables.broadcast_recipients.filter((r) => r.status === 'sent');
    expect(sent.every((r) => r.template_name === 'promo_a')).toBe(true);
  });

  it('does nothing for a campaign that is not sending', async () => {
    const { tables, db } = setup(3);
    tables.broadcasts[0].status = 'scheduled';
    expect(await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 })).toBe(
      'stopped'
    );
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('planned distribution', () => {
  it('sends each recipient on its planned channel and template', async () => {
    sendTemplateMessage.mockImplementation(async () => ({
      messageId: `wamid.${seq++}`,
    }));
    const { tables, db } = setup(8);
    tables.broadcast_recipients.forEach((r, i) => {
      const row = r.row_data as Record<string, string>;
      row.__channel = i % 2 ? 'c2' : 'c1';
      row.__template = i % 2 ? 'promo_b:en_US' : 'promo_a:en_US';
    });

    expect(await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 })).toBe(
      'finished'
    );

    for (const [i, r] of tables.broadcast_recipients.entries()) {
      expect(r).toMatchObject({
        status: 'sent',
        whatsapp_config_id: i % 2 ? 'c2' : 'c1',
        template_name: i % 2 ? 'promo_b' : 'promo_a',
      });
    }
  });

  it("moves a stopped channel's planned share to the other channel", async () => {
    sendTemplateMessage.mockImplementation(
      async (args: { phoneNumberId: string }) => {
        if (args.phoneNumberId === 'p1')
          throw new MetaApiError('Invalid token', {
            code: 190,
            httpStatus: 401,
          });
        return { messageId: `wamid.${seq++}` };
      }
    );
    const { tables, db } = setup(6);
    tables.broadcast_recipients.forEach(
      (r) => ((r.row_data as Record<string, string>).__channel = 'c1')
    );

    expect(await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 })).toBe(
      'finished'
    );
    expect(
      tables.broadcast_recipients.every(
        (r) => r.status === 'sent' && r.whatsapp_config_id === 'c2'
      )
    ).toBe(true);
  });
});

describe('delivery settings', () => {
  const metaError = () =>
    new MetaApiError('(#135000) Generic user error', {
      code: 135000,
      httpStatus: 400,
    });

  it('stop on Meta API error OFF: only that job fails, the campaign continues', async () => {
    sendTemplateMessage.mockImplementation(async (args: { to: string }) => {
      if (args.to.endsWith('03')) throw metaError();
      return { messageId: `wamid.${seq++}` };
    });
    const { tables, db } = setup(8);

    expect(await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 })).toBe(
      'finished'
    );
    const failed = tables.broadcast_recipients.filter(
      (r) => r.status === 'failed'
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].error_message).toContain('[135000]');
    expect(
      tables.broadcast_recipients.filter((r) => r.status === 'sent')
    ).toHaveLength(7);
  });

  it('stop on Meta API error ON: the job fails and this campaign stops for good; the rest are failed', async () => {
    sendTemplateMessage.mockImplementation(async (args: { to: string }) => {
      if (args.to.endsWith('00')) throw metaError();
      return { messageId: `wamid.${seq++}` };
    });
    const { tables, db } = setup(40);
    (tables.broadcasts[0].config as Record<string, unknown>).delivery = {
      stop_on_meta_error: true,
    };
    (tables.broadcasts[0].config as Record<string, unknown>).speed = 2; // slow, so the pause lands early

    expect(
      await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000, maxLanes: 1 })
    ).toBe('stopped');
    const config = tables.broadcasts[0].config as Record<string, unknown>;
    expect(String(config.stopped_reason)).toContain('135000');
    const recs = tables.broadcast_recipients;
    // Nothing left pending → nothing a Resume could pick up.
    expect(recs.filter((r) => r.status === 'pending')).toHaveLength(0);
    // Exactly one recipient carries Meta's own error (the trigger).
    expect(
      recs.filter((r) => String(r.error_message).startsWith('[135000]'))
    ).toHaveLength(1);
    expect(
      recs.filter((r) => String(r.error_message).startsWith('Campaign stopped')).length
    ).toBeGreaterThan(20);
    // r0 (…00) is first in line, so nothing went out before the stop:
    // the campaign settles as failed, with nothing left to resume.
    expect(tables.broadcasts[0].status).toBe('failed');
  });

  it('held_for_quality_assessment is a successful send; with the setting on it stops the campaign for good', async () => {
    sendTemplateMessage.mockImplementation(async (args: { to: string }) => ({
      messageId: `wamid.${seq++}`,
      messageStatus: args.to.endsWith('00')
        ? 'held_for_quality_assessment'
        : 'accepted',
    }));
    const { tables, db } = setup(40);
    (tables.broadcasts[0].config as Record<string, unknown>).delivery = {
      pause_on_quality_hold: true,
    };
    (tables.broadcasts[0].config as Record<string, unknown>).speed = 2;

    expect(
      await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000, maxLanes: 1 })
    ).toBe('stopped');
    const held = tables.broadcast_recipients.find(
      (r) => r.meta_message_status === 'held_for_quality_assessment'
    );
    expect(held).toMatchObject({
      status: 'sent',
      whatsapp_message_id: expect.stringMatching(/^wamid\./),
    });
    // The held message stays sent; everything not yet sent is closed.
    expect(
      tables.broadcast_recipients.filter((r) => r.status === 'pending')
    ).toHaveLength(0);
    expect(
      tables.broadcast_recipients
        .filter((r) => r.status === 'failed')
        .every((r) => String(r.error_message).startsWith('Campaign stopped'))
    ).toBe(true);
    expect(
      String(
        (tables.broadcasts[0].config as Record<string, unknown>).stopped_reason
      )
    ).toContain('quality assessment');
  });

  it('held_for_quality_assessment with the setting off: just sent, campaign continues', async () => {
    sendTemplateMessage.mockImplementation(async () => ({
      messageId: `wamid.${seq++}`,
      messageStatus: 'held_for_quality_assessment',
    }));
    const { tables, db } = setup(6);
    expect(await runAdvancedCampaign(db, 'b1', { budgetMs: 10_000 })).toBe(
      'finished'
    );
    expect(tables.broadcast_recipients.every((r) => r.status === 'sent')).toBe(
      true
    );
  });
});
