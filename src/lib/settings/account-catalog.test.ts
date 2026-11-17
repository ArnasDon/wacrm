import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PAGE_SIZE } from '@/lib/supabase/paged-query';
import { fetchAccountTags, fetchAccountTemplates } from './account-catalog';

interface Recorded {
  table: string;
  filters: [string, unknown][];
  ranges: [number, number][];
}

function fakeDb(rowsByTable: Record<string, { id: string; account_id: string; user_id: string }[]>) {
  const recorded: Recorded[] = [];
  const db = {
    from(table: string) {
      const entry: Recorded = { table, filters: [], ranges: [] };
      recorded.push(entry);
      const builder = {
        select: () => builder,
        order: () => builder,
        eq(column: string, value: unknown) {
          entry.filters.push([column, value]);
          return builder;
        },
        range(from: number, to: number) {
          entry.ranges.push([from, to]);
          const matching = (rowsByTable[table] ?? []).filter((row) =>
            entry.filters.every(
              ([column, value]) => (row as Record<string, unknown>)[column] === value,
            ),
          );
          return Promise.resolve({ data: matching.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, recorded };
}

function rows(count: number, accountId: string, userId: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${accountId}-${userId}-${i}`,
    account_id: accountId,
    user_id: userId,
  }));
}

describe('fetchAccountTemplates', () => {
  it('returns every template in the account, including ones a teammate created', async () => {
    const { db, recorded } = fakeDb({
      message_templates: [
        ...rows(2, 'acct-1', 'me'),
        ...rows(3, 'acct-1', 'teammate'),
        ...rows(4, 'acct-2', 'stranger'),
      ],
    });

    const result = await fetchAccountTemplates(db, 'acct-1');

    expect(result).toHaveLength(5);
    expect(recorded.every((r) => r.table === 'message_templates')).toBe(true);
    expect(recorded[0].filters).toEqual([['account_id', 'acct-1']]);
  });

  it('pages past the 1000-row response cap', async () => {
    const { db } = fakeDb({ message_templates: rows(PAGE_SIZE + 5, 'acct-1', 'me') });

    const result = await fetchAccountTemplates(db, 'acct-1');

    expect(result).toHaveLength(PAGE_SIZE + 5);
  });
});

describe('fetchAccountTags', () => {
  it('scopes tags by account rather than by the caller', async () => {
    const { db, recorded } = fakeDb({
      tags: [...rows(1, 'acct-1', 'me'), ...rows(2, 'acct-1', 'teammate'), ...rows(1, 'acct-2', 'x')],
    });

    const result = await fetchAccountTags(db, 'acct-1');

    expect(result).toHaveLength(3);
    expect(recorded[0].filters).toEqual([['account_id', 'acct-1']]);
    expect(recorded[0].filters.some(([column]) => column === 'user_id')).toBe(false);
  });
});
