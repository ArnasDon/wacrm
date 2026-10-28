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
  linksByTagId?: Record<string, string[]>;
  linkUpsertError?: { message: string };
}) {
  const calls = {
    patterns: [] as string[][],
    ranges: [] as [number, number][],
    inserts: [] as unknown[],
    deletedIds: [] as string[],
    events: [] as string[],
    linkUpserts: [] as { contact_id: string; tag_id: string }[][],
  };
  let lookupIndex = 0;

  function tagsTable() {
    return {
      select: () => {
        const query = {
          eq: () => query,
          ilikeAnyOf: (_column: string, patterns: string[]) => {
            calls.patterns.push(patterns);
            return query;
          },
          order: () => query,
          range: (from: number, to: number) => {
            calls.ranges.push([from, to]);
            return query;
          },
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
          eq: (column: string, value: string) => {
            if (column === 'id') {
              calls.deletedIds.push(value);
              calls.events.push(`delete-tag:${value}`);
              return Promise.resolve({ error: null });
            }
            return query;
          },
        };
        return query;
      },
    };
  }

  function contactTagsTable() {
    return {
      select: () => {
        let tagId = '';
        let from = 0;
        let to = 0;
        const query = {
          eq: (_column: string, value: string) => {
            tagId = value;
            return query;
          },
          order: () => query,
          range: (start: number, end: number) => {
            from = start;
            to = end;
            return query;
          },
          then: (
            resolve: (v: { data: { contact_id: string }[]; error: null }) => void
          ) => {
            const links = (options.linksByTagId?.[tagId] ?? []).slice(from, to + 1);
            calls.events.push(`read-links:${tagId}`);
            resolve({
              data: links.map((contactId) => ({ contact_id: contactId })),
              error: null,
            });
          },
        };
        return query;
      },
      upsert: async (rows: { contact_id: string; tag_id: string }[]) => {
        calls.linkUpserts.push(rows);
        calls.events.push('upsert-links');
        return { error: options.linkUpsertError ?? null };
      },
    };
  }

  const db = {
    from(table: string) {
      if (table === 'tags') return tagsTable();
      if (table === 'contact_tags') return contactTagsTable();
      throw new Error(`unexpected table ${table}`);
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
    expect(calls.deletedIds).toEqual(['t-mine']);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('turns LIKE wildcards into single-character matches so they cannot match every tag', async () => {
    const { db, calls } = fakeTagsDb({ lookups: [[]] });

    await resolveImportTagIds(db, {
      ...params,
      canCreateTags: false,
      tagNames: ['%', '*', '50% off'],
    });

    expect(calls.patterns).toEqual([['"_"', '"_"', '"50_ off"']]);
  });

  it('pages through look-alike matches instead of trusting the first 1000 rows', async () => {
    const lookAlikes = Array.from({ length: 1000 }, (_, i) => ({
      id: `t-${i}`,
      name: String(i % 10),
    }));
    const { db, calls } = fakeTagsDb({
      lookups: [lookAlikes, [{ id: 't-percent', name: '%' }]],
    });

    const result = await resolveImportTagIds(db, {
      ...params,
      tagNames: ['%'],
    });

    expect(calls.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(result.tagIdByKey).toEqual(new Map([['%', 't-percent']]));
    expect(calls.inserts).toEqual([]);
  });

  it('moves contacts linked to the losing copy onto the winner before deleting it', async () => {
    const { db, calls } = fakeTagsDb({
      lookups: [
        [],
        [
          { id: 't-winner', name: 'Lead' },
          { id: 't-mine', name: 'lead' },
        ],
      ],
      inserted: [{ id: 't-mine', name: 'lead' }],
      linksByTagId: { 't-mine': ['c-1', 'c-2'] },
    });

    await resolveImportTagIds(db, { ...params, tagNames: ['lead'] });

    expect(calls.linkUpserts).toEqual([
      [
        { contact_id: 'c-1', tag_id: 't-winner' },
        { contact_id: 'c-2', tag_id: 't-winner' },
      ],
    ]);
    expect(calls.events).toEqual([
      'read-links:t-mine',
      'upsert-links',
      'delete-tag:t-mine',
    ]);
  });

  it('keeps the losing copy when its contacts could not be moved', async () => {
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
      linksByTagId: { 't-mine': ['c-1'] },
      linkUpsertError: { message: 'boom' },
    });

    const result = await resolveImportTagIds(db, {
      ...params,
      tagNames: ['lead'],
    });

    expect(result.tagIdByKey.get('lead')).toBe('t-winner');
    expect(calls.deletedIds).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[resolve-import-tags] duplicate tag cleanup failed:',
      'boom'
    );
    warn.mockRestore();
  });
});
