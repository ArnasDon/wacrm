import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  addContactTag: vi.fn(),
}));

vi.mock('@/lib/automations/engine', () => ({
  addContactTag: h.addContactTag,
}));

import {
  serializeContact,
  findOrCreateContact,
  setContactTags,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff' } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });
});

function fakeDb(opts: {
  tags: { id: string; name: string }[];
  currentContactTagIds: string[];
}) {
  const deleteCalls: { tagIds: string[] }[] = [];
  const db = {
    from: (table: string) => {
      if (table === 'tags') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: opts.tags, error: null }),
          }),
        };
      }
      if (table === 'contact_tags') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: opts.currentContactTagIds.map((tag_id) => ({ tag_id })),
                error: null,
              }),
          }),
          delete: () => ({
            eq: () => ({
              in: (_col: string, ids: string[]) => {
                deleteCalls.push({ tagIds: ids });
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
  return { db, deleteCalls };
}

describe('setContactTags', () => {
  beforeEach(() => {
    h.addContactTag.mockReset();
    h.addContactTag.mockResolvedValue({ added: true });
  });

  it('adds each newly-desired tag via addContactTag, not a raw insert', async () => {
    const { db } = fakeDb({
      tags: [
        { id: 't1', name: 'vip' },
        { id: 't2', name: 'newsletter' },
      ],
      currentContactTagIds: ['t1'],
    });

    await setContactTags(db, 'acct-1', 'user-1', 'contact-1', ['vip', 'newsletter']);

    expect(h.addContactTag).toHaveBeenCalledTimes(1);
    expect(h.addContactTag).toHaveBeenCalledWith({
      accountId: 'acct-1',
      contactId: 'contact-1',
      tagId: 't2',
    });
  });

  it('throws a ContactError when addContactTag fails to add', async () => {
    h.addContactTag.mockResolvedValue({ added: false });
    const { db } = fakeDb({
      tags: [{ id: 't1', name: 'vip' }],
      currentContactTagIds: [],
    });

    await expect(
      setContactTags(db, 'acct-1', 'user-1', 'contact-1', ['vip']),
    ).rejects.toBeInstanceOf(ContactError);
  });

  it('removes no-longer-desired tags via a direct delete, unaffected by addContactTag', async () => {
    const { db, deleteCalls } = fakeDb({
      tags: [{ id: 't1', name: 'vip' }],
      currentContactTagIds: ['t1', 't-stale'],
    });

    await setContactTags(db, 'acct-1', 'user-1', 'contact-1', ['vip']);

    expect(deleteCalls).toEqual([{ tagIds: ['t-stale'] }]);
    expect(h.addContactTag).not.toHaveBeenCalled();
  });
});
