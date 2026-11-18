// ============================================================
// A corrected phone number.
//
// Staff type a wrong number, a message goes to a stranger, staff fix
// the number in the ERP. From then on nothing may go to the old
// number. Two ways it still could:
//
//  1. The event that carries the new number found the contact by its
//     ERP id BEFORE saving, so the contact in hand still had the old
//     number — and the message went there.
//  2. Another CRM contact already has the new number (the customer
//     once messaged from it), the unique index refused the save, the
//     error was only logged, and every later message kept going to
//     the stranger.
// ============================================================

import { describe, expect, it } from 'vitest';

import { blockedNumberDetail, saveContactFields } from './process';

type Result = { error: { code?: string; message: string } | null };

function ctxWith(results: Result[]) {
  const saves: Array<Record<string, unknown>> = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe('contacts');
      return {
        update: (fields: Record<string, unknown>) => {
          saves.push(fields);
          const result = results.shift() ?? { error: null };
          return { eq: () => ({ eq: async () => result }) };
        },
      };
    },
  };
  const ctx = {
    db,
    accountId: 'acc-1',
    currency: 'INR',
    reviewUrl: null,
    reviewDelayDays: 3,
    allowedBranches: [],
  } as unknown as Parameters<typeof saveContactFields>[0];
  return { ctx, saves };
}

// Made-up numbers in an unassigned-looking range: the repo is public.
const OLD = '911000000001';
const NEW = '911000000002';
const CONTACT = { id: 'contact-1', phone: OLD, marketingOptOut: false };
const UNIQUE = { error: { code: '23505', message: 'duplicate key value' } };

describe('saveContactFields — a corrected number', () => {
  it('saves the new number and says to send there, this same event', async () => {
    const { ctx, saves } = ctxWith([{ error: null }]);
    const out = await saveContactFields(ctx, CONTACT, {
      erpCustomerId: '42',
      name: 'Test Customer',
      phone: `+${NEW}`,
    });
    expect(out).toEqual({ phone: NEW, phoneBlockedBy: null });
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      phone: NEW,
      name: 'Test Customer',
      erp_customer_id: '42',
    });
  });

  it('keeps the stored number when the ERP sends the same one in another format', async () => {
    const { ctx, saves } = ctxWith([{ error: null }]);
    const out = await saveContactFields(
      ctx,
      { ...CONTACT, phone: `+${OLD}` },
      {
        erpCustomerId: '42',
        phone: OLD,
      }
    );
    expect(out).toEqual({ phone: `+${OLD}`, phoneBlockedBy: null });
    expect(saves[0]).not.toHaveProperty('phone');
  });

  it('blocks sending when another contact already has the new number', async () => {
    const { ctx, saves } = ctxWith([UNIQUE, { error: null }]);
    const out = await saveContactFields(ctx, CONTACT, {
      erpCustomerId: '42',
      name: 'Test Customer',
      phone: NEW,
    });
    expect(out).toEqual({ phone: OLD, phoneBlockedBy: NEW });
    // The name and the rest are still kept in step.
    expect(saves).toHaveLength(2);
    expect(saves[1]).not.toHaveProperty('phone');
    expect(saves[1]).toMatchObject({ name: 'Test Customer' });
  });

  it('throws on any other error, so the ERP retries instead of messaging the old number', async () => {
    const { ctx } = ctxWith([
      { error: { code: '57014', message: 'statement timeout' } },
    ]);
    await expect(
      saveContactFields(ctx, CONTACT, { erpCustomerId: '42', phone: NEW })
    ).rejects.toThrow(/new number/);
  });

  it('does not throw for an error when the number is unchanged', async () => {
    // Unchanged behaviour: a failed name/email update only logs.
    const { ctx } = ctxWith([{ error: { message: 'boom' } }]);
    const out = await saveContactFields(ctx, CONTACT, {
      erpCustomerId: '42',
      phone: OLD,
    });
    expect(out).toEqual({ phone: OLD, phoneBlockedBy: null });
  });

  it('ignores an unusable number from the ERP', async () => {
    const { ctx, saves } = ctxWith([{ error: null }]);
    const out = await saveContactFields(ctx, CONTACT, {
      erpCustomerId: '42',
      phone: '12',
    });
    expect(out).toEqual({ phone: OLD, phoneBlockedBy: null });
    expect(saves[0]).not.toHaveProperty('phone');
  });
});

describe('blockedNumberDetail', () => {
  it('names both numbers and what to do', () => {
    const d = blockedNumberDetail(OLD, NEW);
    expect(d.startsWith('not sent:')).toBe(true);
    expect(d).toContain(OLD);
    expect(d).toContain(NEW);
    expect(d).toMatch(/resend from the ERP/);
  });
});
