import { describe, expect, it, vi } from 'vitest';
import type { SqlConnection } from '@/lib/db/transaction';

import { BroadcastError } from './broadcast-core';
import {
  claimBroadcastDelivery,
  planBroadcastResume,
  releaseBroadcastDelivery,
  RESUME_MAX_PER_REQUEST,
} from './broadcast-resume';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `decrypted:${v}`,
}));

// ============================================================
// Claim / release — the mutex that stops a double-send.
// ============================================================

interface ClaimCall {
  update: Record<string, unknown>;
  filters: Record<string, unknown>;
  or?: string;
}

function claimDb(returnedRows: unknown[], calls: ClaimCall[]): SqlConnection {
  return {
    query: async (sql, values = []) => {
      calls.push({
        update: sql.includes('delivery_locked_at=NULL')
          ? { delivery_locked_at: null }
          : { delivery_locked_at: values[2] },
        filters: { account_id: values[0], id: values[1] },
        or: 'delivery_locked_at.is.null,delivery_locked_at.lt.' + values[3],
      });
      return { rows: returnedRows };
    },
  };
}

describe('claimBroadcastDelivery', () => {
  it('claims when the conditional UPDATE matched a row', async () => {
    const calls: ClaimCall[] = [];
    const ok = await claimBroadcastDelivery(
      claimDb([{ id: 'bc-1' }], calls),
      'acct-1',
      'bc-1',
      new Date('2026-08-11T12:00:00Z')
    );

    expect(ok).toBe(true);
    expect(calls[0].filters).toEqual({ id: 'bc-1', account_id: 'acct-1' });
    expect(calls[0].update.delivery_locked_at).toBe('2026-08-11T12:00:00.000Z');
  });

  it('refuses when another pass already holds the lock', async () => {
    // The UPDATE's WHERE didn't match — someone else got there first.
    const ok = await claimBroadcastDelivery(claimDb([], []), 'acct-1', 'bc-1');
    expect(ok).toBe(false);
  });

  it('treats a lock older than the staleness window as abandoned', async () => {
    const calls: ClaimCall[] = [];
    await claimBroadcastDelivery(
      claimDb([{ id: 'bc-1' }], calls),
      'acct-1',
      'bc-1',
      new Date('2026-08-11T12:00:00Z')
    );
    // 30 minutes before "now" — a pass whose process died is recoverable
    // without touching the database by hand.
    expect(calls[0].or).toBe(
      'delivery_locked_at.is.null,delivery_locked_at.lt.2026-08-11T11:30:00.000Z'
    );
  });

  it('is scoped to the account, so another tenant cannot claim it', async () => {
    const calls: ClaimCall[] = [];
    await claimBroadcastDelivery(claimDb([], calls), 'acct-9', 'bc-1');
    expect(calls[0].filters.account_id).toBe('acct-9');
  });
});

describe('releaseBroadcastDelivery', () => {
  it('clears the lock', async () => {
    const calls: ClaimCall[] = [];
    await releaseBroadcastDelivery(claimDb([], calls), 'bc-1', 'acct-1');
    expect(calls[0].update).toEqual({ delivery_locked_at: null });
    expect(calls[0].filters).toEqual({ id: 'bc-1', account_id: 'acct-1' });
  });
});

// ============================================================
// Planning — which recipients a pass picks up, and with what params.
// ============================================================

interface PlanFixture {
  broadcast?: Record<string, unknown> | null;
  recipients?: Record<string, unknown>[];
  config?: Record<string, unknown> | null;
  templates?: Record<string, unknown>[];
}

interface PlanWrites {
  statusFilter?: unknown;
  failedIds?: unknown;
  failedUpdate?: Record<string, unknown>;
}

function planDb(fx: PlanFixture, writes: PlanWrites = {}): SqlConnection {
  return {
    query: async (sql, values = []) => {
      if (sql.includes('SELECT * FROM public.broadcasts'))
        return { rows: fx.broadcast ? [fx.broadcast] : [] };
      if (sql.includes('FROM public.whatsapp_config'))
        return { rows: fx.config ? [fx.config] : [] };
      if (sql.includes('FROM public.message_templates'))
        return { rows: fx.templates ?? [] };
      if (sql.includes('SELECT r.*')) {
        writes.statusFilter = values[2];
        return { rows: fx.recipients ?? [] };
      }
      if (sql.includes('UPDATE public.broadcast_recipients')) {
        writes.failedIds = [
          ...((writes.failedIds as unknown[]) ?? []),
          values[2],
        ];
        writes.failedUpdate = { status: 'failed' };
        return { rows: [] };
      }
      throw new Error('Unexpected SQL');
    },
  };
}

const BROADCAST = {
  id: 'bc-1',
  template_name: 'order_update',
  template_language: 'en_US',
};

const CONFIG = { phone_number_id: 'pn-1', access_token: 'tok' };

function recipient(
  id: string,
  phone: string | null,
  params: unknown = ['A123']
) {
  return {
    id,
    template_params: params,
    contact: phone ? { phone } : null,
  };
}

describe('planBroadcastResume', () => {
  it('commits failed recipients even when every phone is unsendable', async () => {
    const writes: PlanWrites = {};
    const result = await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [recipient('gone', null)],
        },
        writes
      ),
      'acct-1',
      'bc-1',
      'pending'
    );
    expect(result.plan.planned).toEqual([]);
    expect(result.unsendable).toBe(1);
    expect(writes.failedIds).toEqual(['gone']);
  });
  it('plans the outstanding recipients with their frozen params', async () => {
    const writes: PlanWrites = {};
    const { plan, remaining, unsendable } = await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [
            recipient('r1', '+15551234567', ['A123', 'Friday']),
            recipient('r2', '+15559876543', ['B456', 'Monday']),
          ],
        },
        writes
      ),
      'acct-1',
      'bc-1',
      'pending'
    );

    expect(writes.statusFilter).toEqual(['pending']);
    // Phones are stored sanitized (no leading '+'), same as the shape
    // createBroadcast plans — deliverBroadcast feeds them to
    // phoneVariants from here.
    expect(plan.planned).toEqual([
      {
        recipientRowId: 'r1',
        phone: '15551234567',
        params: ['A123', 'Friday'],
      },
      {
        recipientRowId: 'r2',
        phone: '15559876543',
        params: ['B456', 'Monday'],
      },
    ]);
    expect(plan.accessToken).toBe('decrypted:tok');
    expect(remaining).toBe(0);
    expect(unsendable).toBe(0);
  });

  it('scopes to failed rows when retrying, and to both for "all"', async () => {
    const failedWrites: PlanWrites = {};
    await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [recipient('r1', '+15551234567')],
        },
        failedWrites
      ),
      'acct-1',
      'bc-1',
      'failed'
    );
    expect(failedWrites.statusFilter).toEqual(['failed']);

    const allWrites: PlanWrites = {};
    await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [recipient('r1', '+15551234567')],
        },
        allWrites
      ),
      'acct-1',
      'bc-1',
      'all'
    );
    expect(allWrites.statusFilter).toEqual(['pending', 'failed']);
  });

  it('treats a missing or malformed params column as no params', async () => {
    const { plan } = await planBroadcastResume(
      planDb({
        broadcast: BROADCAST,
        config: CONFIG,
        recipients: [
          // Rows created before migration 038 carry NULL.
          recipient('r1', '+15551234567', null),
          recipient('r2', '+15559876543', 'not-an-array'),
        ],
      }),
      'acct-1',
      'bc-1',
      'pending'
    );
    expect(plan.planned.map((p) => p.params)).toEqual([[], []]);
  });

  it('fails unsendable rows up front so they stop blocking the status', async () => {
    const writes: PlanWrites = {};
    const { plan, unsendable } = await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [
            recipient('r1', '+15551234567'),
            recipient('r2', null),
            recipient('r3', 'nonsense'),
          ],
        },
        writes
      ),
      'acct-1',
      'bc-1',
      'pending'
    );

    // Left 'pending', these would keep the broadcast in 'sending'
    // forever — the exact symptom being fixed.
    expect(unsendable).toBe(2);
    expect(writes.failedIds).toEqual(['r2', 'r3']);
    expect(writes.failedUpdate?.status).toBe('failed');
    expect(plan.planned).toHaveLength(1);
  });

  it('caps one pass and reports the leftover', async () => {
    const many = Array.from({ length: RESUME_MAX_PER_REQUEST + 25 }, (_, i) =>
      recipient(`r${i}`, '+1555000' + String(i).padStart(4, '0'))
    );
    const { plan, remaining } = await planBroadcastResume(
      planDb({ broadcast: BROADCAST, config: CONFIG, recipients: many }),
      'acct-1',
      'bc-1',
      'pending'
    );
    expect(plan.planned).toHaveLength(RESUME_MAX_PER_REQUEST);
    // Surfaced to the caller rather than silently dropped.
    expect(remaining).toBe(25);
  });

  it('404s a broadcast that is not on this account', async () => {
    await expect(
      planBroadcastResume(
        planDb({ broadcast: null }),
        'acct-1',
        'bc-1',
        'pending'
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses when there is nothing outstanding', async () => {
    await expect(
      planBroadcastResume(
        planDb({ broadcast: BROADCAST, config: CONFIG, recipients: [] }),
        'acct-1',
        'bc-1',
        'failed'
      )
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('resolves the template row for header + button components', async () => {
    const { plan } = await planBroadcastResume(
      planDb({
        broadcast: { ...BROADCAST, template_language: 'en_US' },
        config: CONFIG,
        recipients: [recipient('r1', '+15551234567')],
        templates: [
          {
            id: 'tpl-1',
            user_id: 'u-1',
            name: 'order_update',
            // Synced from Meta as bare 'en' — the resolver bridges it.
            language: 'en',
            body_text: 'Your order {{1}} ships on {{2}}',
          },
        ],
      }),
      'acct-1',
      'bc-1',
      'pending'
    );
    expect(plan.templateRow?.language).toBe('en');
  });
});
