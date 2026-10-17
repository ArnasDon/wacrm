import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveImportTagIds } from './resolve-import-tags';

interface TagRow {
  id: string;
  name: string;
}

function fakeTagsDb(options: {
  lookups: TagRow[][];
  inserted?: TagRow[];
}) {
  const calls = {
    patterns: [] as string[][],
    inserts: [] as unknown[],
    deletedIds: [] as string[][],
  };
  let lookupIndex = 0;

  const db = {
    from(table: string) {
      expect(table).toBe('tags');
      return {
        select: () => {
          const query = {
            eq: () => query,
            ilikeAnyOf: (_column: string, patterns: string[]) => {
              calls.patterns.push(patterns);
              return query;
            },
            order: () => query,
            then: (resolve: (v: { data: TagRow[]; error: null }) => void) =>
              resolve({ data: options.lookups[lookupIndex++] ?? [], error: null }),
          };
          return query;
        },
        insert: (rows: unknown) => {
          calls.inserts.push(rows);
          return {
            select: async () => ({ data: options.inserted ?? [], error: null }),
          };
        },
        delete: () => {
          const query = {
            eq: () => query,
            in: async (_column: string, ids: string[]) => {
              calls.deletedIds.push(ids);
              return { error: null };
            },
          };
          return query;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, calls };
}

const params = {
  accountId: 'acc',
  userId: 'user',
  canCreateTags: true,
};

describe('resolveImportTagIds', () => {
  it('looks up only the requested names instead of loading every tag', async () => {
    const { db, calls } = fakeTagsDb({
      lookups: [[{ id: 't-vip', name: 'VIP' }]],
    });

    const result = await resolveImportTagIds(db, {
      ...params,
      tagNames: [' vip ', 'VIP'],
    });

    expect(calls.patterns).toEqual([['"vip"']]);
    expect(result.tagIdByKey).toEqual(new Map([['vip', 't-vip']]));
    expect(calls.inserts).toEqual([]);
  });

  it('ignores wildcard look-alikes returned by the pattern match', async () => {
    const { db, calls } = fakeTagsDb({
      lookups: [
        [{ id: 't-abc', name: 'abc' }],
        [
          { id: 't-abc', name: 'abc' },
          { id: 't-new', name: 'a_c' },
        ],
      ],
      inserted: [{ id: 't-new', name: 'a_c' }],
    });

    const result = await resolveImportTagIds(db, {
      ...params,
      tagNames: ['a_c'],
    });

    expect(result.tagIdByKey).toEqual(new Map([['a_c', 't-new']]));
    expect(calls.inserts).toHaveLength(1);
    expect(calls.deletedIds).toEqual([]);
  });

  it('neutralises quotes and backslashes so a name cannot break the filter', async () => {
    const { db, calls } = fakeTagsDb({ lookups: [[]] });

    await resolveImportTagIds(db, {
      ...params,
      canCreateTags: false,
      tagNames: ['say "hi"', 'back\\slash', 'a,b'],
    });

    expect(calls.patterns).toEqual([['"say _hi_"', '"back_slash"', '"a,b"']]);
  });

  it('chunks large name lists across several lookups', async () => {
    const { db, calls } = fakeTagsDb({ lookups: [] });
    const tagNames = Array.from({ length: 120 }, (_, i) => `tag-${i}`);

    const result = await resolveImportTagIds(db, {
      ...params,
      canCreateTags: false,
      tagNames,
    });

    expect(calls.patterns.map((chunk) => chunk.length)).toEqual([50, 50, 20]);
    expect(result.skippedNames).toHaveLength(120);
  });

  it('reports missing names as skipped when the caller cannot create tags', async () => {
    const { db, calls } = fakeTagsDb({ lookups: [[]] });

    const result = await resolveImportTagIds(db, {
      ...params,
      canCreateTags: false,
      tagNames: ['new'],
    });

    expect(result.skippedNames).toEqual(['new']);
    expect(calls.inserts).toEqual([]);
  });

  it('creates missing tags and keeps the created id when no other copy exists', async () => {
    const { db, calls } = fakeTagsDb({
      lookups: [[], [{ id: 't-new', name: 'fresh' }]],
      inserted: [{ id: 't-new', name: 'fresh' }],
    });

    const result = await resolveImportTagIds(db, {
      ...params,
      tagNames: ['fresh'],
    });

    expect(result.tagIdByKey.get('fresh')).toBe('t-new');
    expect(calls.inserts).toEqual([
      [{ user_id: 'user', account_id: 'acc', name: 'fresh', color: '#3b82f6' }],
    ]);
    expect(calls.deletedIds).toEqual([]);
  });

  it('converges on the oldest tag and removes its own copy after losing a concurrent create', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, calls } = fakeTagsDb({
      lookups: [
        [],
        [
          { id: 't-winner', name: 'Lead' },
          { id: 't-mine', name: 'lead' },
        ],
      ],
      inserted: [{ id: 't-mine', name: 'lead' }],
    });

    const result = await resolveImportTagIds(db, {
      ...params,
      tagNames: ['lead'],
    });

    expect(result.tagIdByKey.get('lead')).toBe('t-winner');
    expect(calls.deletedIds).toEqual([['t-mine']]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
