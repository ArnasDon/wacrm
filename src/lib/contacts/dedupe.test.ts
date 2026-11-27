import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dedupeByPhone,
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from './dedupe';

describe('normalizeKey', () => {
  it('strips every non-digit', () => {
    expect(normalizeKey('+1 (555) 123-4567')).toBe('15551234567');
    expect(normalizeKey('15551234567')).toBe('15551234567');
  });

  it('collapses different formats of the same number to one key', () => {
    expect(normalizeKey('+44 7911 123456')).toBe(normalizeKey('447911123456'));
  });
});

describe('isExactMatch', () => {
  it('treats different formatting of the same digits as exact', () => {
    expect(
      isExactMatch({ id: '1', phone: '+1 555-123-4567' }, '15551234567')
    ).toBe(true);
  });

  it('is false for a trunk-variant (fuzzy) match', () => {
    // last-8 match but not the same full number
    expect(
      isExactMatch({ id: '1', phone: '37063949836' }, '370063949836')
    ).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('detects Postgres 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });
  it('is false for other errors / non-objects', () => {
    expect(isUniqueViolation({ code: '23502' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('boom')).toBe(false);
  });
});

describe('dedupeByPhone', () => {
  it('keeps the first occurrence and counts in-file duplicates', () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: '+1 555-1111', name: 'A' },
      { phone: '15551111', name: 'B' }, // same digits as #1
      { phone: '+1 555-2222', name: 'C' },
    ]);
    expect(unique.map((r) => r.name)).toEqual(['A', 'C']);
    expect(duplicates).toBe(1);
  });

  it('drops rows with no digits', () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: '   ' },
      { phone: '+1 555-3333' },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe('findExistingContact', () => {
  // Minimal SupabaseClient stub: records the column queried with .like()
  // and resolves to a fixed candidate set.
  function stubDb(
    rows: Array<{ id: string; phone: string; phone_normalized?: string }>
  ): { db: SupabaseClient; likeCalls: Array<[string, string]> } {
    const likeCalls: Array<[string, string]> = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: (col: string, pattern: string) => {
        likeCalls.push([col, pattern]);
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return {
      db: { from: () => builder } as unknown as SupabaseClient,
      likeCalls,
    };
  }

  it('queries phone_normalized instead of raw phone', async () => {
    const { db, likeCalls } = stubDb([
      {
        id: 'c1',
        phone: '+55 11 98765-4321',
        phone_normalized: '5511987654321',
      },
    ]);
    const hit = await findExistingContact(db, 'acct', '5511987654321');
    expect(hit?.id).toBe('c1');
    expect(likeCalls).toEqual([['phone_normalized', '%87654321']]);
  });

  it('returns a trunk-variant match via phonesMatch', async () => {
    const { db } = stubDb([{ id: 'c1', phone: '37063949836' }]);
    const hit = await findExistingContact(db, 'acct', '+370 063 949 836');
    expect(hit?.id).toBe('c1');
  });

  it('prefers an exact normalized match over a fuzzy last-8 match', async () => {
    const { db } = stubDb([
      { id: 'c-fuzzy', phone: '37063949836' },
      { id: 'c-exact', phone: '+370 063 949 836' },
    ]);
    const hit = await findExistingContact(db, 'acct', '370063949836');
    expect(hit?.id).toBe('c-exact');
  });

  it('returns null when no candidate matches', async () => {
    const { db } = stubDb([{ id: 'c1', phone: '15559999999' }]);
    const hit = await findExistingContact(db, 'acct', '+1 555-123-4567');
    expect(hit).toBeNull();
  });

  it('returns null for an empty phone without querying', async () => {
    const { db } = stubDb([{ id: 'c1', phone: '15551234567' }]);
    expect(await findExistingContact(db, 'acct', '   ')).toBeNull();
  });
});
