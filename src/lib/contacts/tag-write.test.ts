import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { addContactTagIfAbsent } from './tag-write';

interface FakeOptions {
  contact?: { id: string } | null;
  tag?: { id: string } | null;
  insertData?: { id: string } | null;
  insertError?: { code?: string; message: string } | null;
}

function fakeDb(options: FakeOptions = {}): SupabaseClient {
  const contact =
    options.contact === undefined ? { id: 'contact-1' } : options.contact;
  const tag = options.tag === undefined ? { id: 'tag-1' } : options.tag;

  return {
    from(table: string) {
      const state = { operation: 'select' };
      const builder = {
        select() {
          return builder;
        },
        insert() {
          state.operation = 'insert';
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle() {
          if (table === 'contacts')
            return Promise.resolve({ data: contact, error: null });
          if (table === 'tags')
            return Promise.resolve({ data: tag, error: null });
          if (table === 'contact_tags' && state.operation === 'insert') {
            return Promise.resolve({
              data:
                options.insertData === undefined
                  ? { id: 'join-1' }
                  : options.insertData,
              error: options.insertError ?? null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const input = {
  accountId: 'account-1',
  contactId: 'contact-1',
  tagId: 'tag-1',
};

describe('addContactTagIfAbsent', () => {
  it('returns true only when the join row was inserted', async () => {
    await expect(addContactTagIfAbsent(fakeDb(), input)).resolves.toBe(true);
  });

  it('treats an error-free insert as successful even without a returned row', async () => {
    await expect(
      addContactTagIfAbsent(fakeDb({ insertData: null }), input)
    ).resolves.toBe(true);
  });

  it('treats a unique violation as an idempotent duplicate', async () => {
    const db = fakeDb({
      insertData: null,
      insertError: { code: '23505', message: 'duplicate key' },
    });
    await expect(addContactTagIfAbsent(db, input)).resolves.toBe(false);
  });

  it('refuses contacts and tags outside the account', async () => {
    await expect(
      addContactTagIfAbsent(fakeDb({ contact: null }), input)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      addContactTagIfAbsent(fakeDb({ tag: null }), input)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('surfaces non-duplicate insert failures', async () => {
    const db = fakeDb({
      insertData: null,
      insertError: { code: '42501', message: 'permission denied' },
    });
    await expect(addContactTagIfAbsent(db, input)).rejects.toThrow(
      'Failed to add contact tag: permission denied'
    );
  });
});
