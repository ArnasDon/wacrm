import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import {
  createContact,
  listContacts,
  updateContact,
  deleteContacts,
  setContactTag,
  listContactTags,
  findContactByPhone,
} from './contacts';

describe('local contacts repository', () => {
  let db: PGlite;
  const alice = '10000000-0000-4000-8000-000000000001';
  const bob = '10000000-0000-4000-8000-000000000002';
  let accountId: string;
  let contactId: string;
  let tagId: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    await db.query(
      'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
      [alice, 'Alice', 'alice@example.test', bob, 'Bob', 'bob@example.test']
    );
    await db.exec('SET ROLE omni_app');
    accountId = (
      await withIdentity(db, alice, (sql) => resolveAccount(sql, alice))
    ).accountId;
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  const as = <T>(id: string, work: (sql: PGlite) => Promise<T>) =>
    withIdentity(db, id, work);

  it('creates contacts with server-derived ownership and rejects normalized duplicates', async () => {
    const contact = await as(alice, (sql) =>
      createContact(sql, alice, {
        name: 'Customer',
        phone: '+1 (555) 123-4567',
        email: 'customer@example.test',
      })
    );
    contactId = contact.id;
    expect(contact.account_id).toBe(accountId);
    await expect(
      as(alice, (sql) => createContact(sql, alice, { phone: '15551234567' }))
    ).rejects.toMatchObject({ code: '23505' });
    await as(bob, (sql) =>
      createContact(sql, bob, { name: 'Other customer', phone: '15551234567' })
    );
    await as(alice, (sql) =>
      createContact(sql, alice, { name: 'Another', phone: '15559876543' })
    );
  });

  it('searches and paginates only the current account and treats SQL input as data', async () => {
    const page = await as(alice, (sql) =>
      listContacts(sql, accountId, { limit: 1, offset: 0 })
    );
    expect(page.contacts).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(
      (
        await as(alice, (sql) =>
          listContacts(sql, accountId, { search: 'Customer' })
        )
      ).total
    ).toBe(1);
    expect(
      (
        await as(alice, (sql) =>
          listContacts(sql, accountId, { search: "' OR 1=1 --" })
        )
      ).total
    ).toBe(0);
    expect((await as(bob, (sql) => listContacts(sql, accountId))).total).toBe(
      0
    );
    expect(
      (
        await as(alice, (sql) =>
          findContactByPhone(sql, accountId, '1 555 123 4567')
        )
      )?.id
    ).toBe(contactId);
    expect(
      await as(bob, (sql) =>
        findContactByPhone(sql, accountId, '1 555 123 4567')
      )
    ).toBeNull();
  });

  it('validates both sides of a tag assignment and filters by tags', async () => {
    const result = await as(alice, (sql) =>
      sql.query<{ id: string }>(
        'INSERT INTO public.tags(user_id,account_id,name) VALUES ($1,$2,$3) RETURNING id',
        [alice, accountId, 'Customer']
      )
    );
    tagId = result.rows[0].id;
    expect(
      await as(alice, (sql) =>
        setContactTag(sql, accountId, contactId, tagId, true)
      )
    ).toBe(true);
    expect(
      await as(alice, (sql) =>
        setContactTag(sql, accountId, contactId, tagId, true)
      )
    ).toBe(false);
    expect(
      await as(alice, (sql) => listContactTags(sql, accountId, contactId))
    ).toHaveLength(1);
    expect(
      (
        await as(alice, (sql) =>
          listContacts(sql, accountId, { tagIds: [tagId] })
        )
      ).total
    ).toBe(1);
    await expect(
      as(bob, (sql) => setContactTag(sql, accountId, contactId, tagId, true))
    ).rejects.toThrow(/not found/);
  });

  it('updates and deletes only owned contacts with cascading tag cleanup', async () => {
    expect(
      await as(bob, (sql) =>
        updateContact(sql, accountId, contactId, { name: 'Hacked' })
      )
    ).toBeNull();
    expect(
      (
        await as(alice, (sql) =>
          updateContact(sql, accountId, contactId, { name: 'Updated' })
        )
      )?.name
    ).toBe('Updated');
    expect(
      await as(bob, (sql) => deleteContacts(sql, accountId, [contactId]))
    ).toBe(0);
    expect(
      await as(alice, (sql) => deleteContacts(sql, accountId, [contactId]))
    ).toBe(1);
    expect(
      await as(alice, (sql) => listContactTags(sql, accountId, contactId))
    ).toHaveLength(0);
  });
});
