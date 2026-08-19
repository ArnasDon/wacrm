import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAudienceContacts } from './audience';

interface FakeContact {
  id: string;
  phone: string | null;
  account_id: string;
  whatsapp_status: string;
  opt_in_status: string;
  role: string;
  market_id: string | null;
}

function fakeDb(contacts: FakeContact[]) {
  return {
    from: () => {
      const filters: { field: string; op: string; value: unknown }[] = [];
      const builder = {
        select: () => builder,
        eq: (field: string, value: unknown) => {
          filters.push({ field, op: 'eq', value });
          return builder;
        },
        in: (field: string, value: unknown[]) => {
          filters.push({ field, op: 'in', value });
          return builder;
        },
        not: () => builder,
        then: (
          resolve: (r: { data: FakeContact[]; error: null }) => unknown
        ) => {
          const matched = contacts.filter((c) =>
            filters.every((f) => {
              const actual = (c as unknown as Record<string, unknown>)[f.field];
              if (f.op === 'eq') return actual === f.value;
              if (f.op === 'in') return (f.value as unknown[]).includes(actual);
              return true;
            })
          );
          return resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const BASE = {
  account_id: 'acct-1',
  whatsapp_status: 'confirmed',
  opt_in_status: 'opted_in',
};

describe('resolveAudienceContacts', () => {
  it('returns every confirmed, opted-in contact when no filters are given', async () => {
    const contacts: FakeContact[] = [
      { id: 'c1', phone: '+15551', ...BASE, role: 'Mechanic', market_id: 'm1' },
      {
        id: 'c2',
        phone: '+15552',
        ...BASE,
        role: 'Truck Driver',
        market_id: 'm2',
      },
    ];
    const result = await resolveAudienceContacts(
      fakeDb(contacts),
      'acct-1',
      {}
    );
    expect(result.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('filters by role', async () => {
    const contacts: FakeContact[] = [
      { id: 'c1', phone: '+15551', ...BASE, role: 'Mechanic', market_id: null },
      {
        id: 'c2',
        phone: '+15552',
        ...BASE,
        role: 'Truck Driver',
        market_id: null,
      },
    ];
    const result = await resolveAudienceContacts(fakeDb(contacts), 'acct-1', {
      roles: ['Mechanic'],
    });
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });

  it('treats markets: ["all"] as no market filter', async () => {
    const contacts: FakeContact[] = [
      { id: 'c1', phone: '+15551', ...BASE, role: 'Mechanic', market_id: 'm1' },
      { id: 'c2', phone: '+15552', ...BASE, role: 'Mechanic', market_id: 'm2' },
    ];
    const result = await resolveAudienceContacts(fakeDb(contacts), 'acct-1', {
      markets: ['all'],
    });
    expect(result).toHaveLength(2);
  });

  it('drops a matched row with no phone rather than erroring', async () => {
    const contacts: FakeContact[] = [
      { id: 'c1', phone: null, ...BASE, role: 'Mechanic', market_id: null },
      { id: 'c2', phone: '+15552', ...BASE, role: 'Mechanic', market_id: null },
    ];
    const result = await resolveAudienceContacts(
      fakeDb(contacts),
      'acct-1',
      {}
    );
    expect(result.map((c) => c.id)).toEqual(['c2']);
  });

  it('throws on a DB error rather than returning an empty audience silently', async () => {
    const db = {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          not: () => builder,
          then: (
            resolve: (r: { data: null; error: { message: string } }) => unknown
          ) => resolve({ data: null, error: { message: 'connection reset' } }),
        };
        return builder;
      },
    } as unknown as SupabaseClient;
    await expect(resolveAudienceContacts(db, 'acct-1', {})).rejects.toThrow(
      'connection reset'
    );
  });
});
