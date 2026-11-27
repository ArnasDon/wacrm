import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertCsvContactsForAccount } from './use-broadcast-sending';

type ContactRow = {
  id: string;
  account_id: string;
  user_id: string;
  phone: string;
  phone_normalized: string;
  name: string | null;
};

function makeBroadcastDb(options: {
  initialContacts: ContactRow[];
  simulateRaceInsert?: boolean;
}) {
  const rows = options.initialContacts.map((r) => ({ ...r }));
  const eqCalls: Array<{ op: string; col: string; val: unknown }> = [];
  const inCalls: Array<{ op: string; col: string; vals: unknown[] }> = [];
  const insertBatches: unknown[] = [];
  let racedOnce = false;

  const db = {
    from: (table: string) => {
      expect(table).toBe('contacts');
      let mode: 'select' | 'insert' = 'select';
      let pendingInsert: Array<Record<string, unknown>> = [];
      let accountFilter: unknown;
      let inCol = '';
      let inVals: unknown[] = [];

      const execute = () => {
        if (mode === 'insert') {
          insertBatches.push(pendingInsert);
          if (options.simulateRaceInsert && !racedOnce) {
            racedOnce = true;
            // Concurrent writer created the contact first.
            for (const item of pendingInsert) {
              const normalized = String(item.phone).replace(/\D/g, '');
              rows.push({
                id: `raced-${rows.length + 1}`,
                account_id: String(item.account_id),
                user_id: 'other-agent',
                phone: normalized,
                phone_normalized: normalized,
                name: (item.name as string | null) ?? null,
              });
            }
            return { data: null, error: { code: '23505', message: 'duplicate' } };
          }

          const created = pendingInsert.map((item, idx) => {
            const normalized = String(item.phone).replace(/\D/g, '');
            const row: ContactRow = {
              id: `inserted-${rows.length + idx + 1}`,
              account_id: String(item.account_id),
              user_id: String(item.user_id),
              phone: normalized,
              phone_normalized: normalized,
              name: (item.name as string | null) ?? null,
            };
            rows.push(row);
            return row;
          });
          return { data: created, error: null };
        }

        const filtered = rows.filter((r) => {
          if (accountFilter !== undefined && r.account_id !== accountFilter) {
            return false;
          }
          if (inCol) {
            return inVals.includes(
              r[inCol as keyof ContactRow] as unknown
            );
          }
          return true;
        });
        return { data: filtered, error: null };
      };

      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          eqCalls.push({ op: mode, col, val });
          if (col === 'account_id') accountFilter = val;
          return q;
        },
        in: (col: string, vals: unknown[]) => {
          inCalls.push({ op: mode, col, vals });
          inCol = col;
          inVals = vals;
          return q;
        },
        insert: (batch: Array<Record<string, unknown>>) => {
          mode = 'insert';
          pendingInsert = batch;
          return q;
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(execute()).then(resolve),
      };
      return q;
    },
  } as unknown as ReturnType<typeof import('@/lib/supabase/client').createClient>;

  return { db: db as unknown as SupabaseClient & typeof db, eqCalls, inCalls, insertBatches };
}

describe('upsertCsvContactsForAccount', () => {
  it('filters by account_id and phone_normalized, matching formatted contacts created by teammates', async () => {
    const { db, eqCalls, inCalls, insertBatches } = makeBroadcastDb({
      initialContacts: [
        {
          id: 'existing-1',
          account_id: 'acct-1',
          user_id: 'teammate-user',
          phone: '+55 11 98765-4321',
          phone_normalized: '5511987654321',
          name: 'Maria',
        },
      ],
    });

    const contacts = await upsertCsvContactsForAccount(
      db as unknown as ReturnType<typeof import('@/lib/supabase/client').createClient>,
      {
        accountId: 'acct-1',
        userId: 'current-user',
        csvRows: [
          { phone: '55 (11) 98765-4321', name: 'Maria Dup' },
          { phone: '+5511987654321', name: 'Maria Same CSV' },
          { phone: '+55 11 91234-5678', name: 'João' },
          { phone: '   ', name: 'Inválido' },
        ],
      }
    );

    expect(eqCalls).toContainEqual({
      op: 'select',
      col: 'account_id',
      val: 'acct-1',
    });
    expect(eqCalls.some((c) => c.col === 'user_id')).toBe(false);
    expect(inCalls).toContainEqual({
      op: 'select',
      col: 'phone_normalized',
      vals: ['5511987654321', '5511912345678'],
    });
    expect(insertBatches).toHaveLength(1);
    expect(insertBatches[0]).toEqual([
      {
        user_id: 'current-user',
        account_id: 'acct-1',
        phone: '5511912345678',
        name: 'João',
      },
    ]);
    expect(contacts.map((c) => c.id)).toEqual(['existing-1', 'inserted-2']);
  });

  it('recovers cleanly on 23505 race condition during batch insert', async () => {
    const { db } = makeBroadcastDb({
      initialContacts: [],
      simulateRaceInsert: true,
    });

    const contacts = await upsertCsvContactsForAccount(
      db as unknown as ReturnType<typeof import('@/lib/supabase/client').createClient>,
      {
        accountId: 'acct-1',
        userId: 'current-user',
        csvRows: [{ phone: '+55 11 99999-0000', name: 'Carlos' }],
      }
    );

    expect(contacts).toHaveLength(1);
    expect(contacts[0].id).toBe('raced-1');
    expect(contacts[0].phone).toBe('5511999990000');
  });
});
