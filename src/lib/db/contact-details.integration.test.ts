import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import { createContact } from './contacts';
import {
  createCustomField,
  listCustomFields,
  renameCustomField,
  deleteCustomField,
  setCustomValues,
  getCustomValues,
  addNote,
  listNotes,
  deleteNote,
} from './contact-details';

describe('local custom fields and contact notes', () => {
  let db: PGlite;
  const alice = '10000000-0000-4000-8000-000000000001';
  const bob = '10000000-0000-4000-8000-000000000002';
  let accountId: string;
  let contactId: string;
  let foreignField: string;
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
    contactId = (
      await withIdentity(db, alice, (sql) =>
        createContact(sql, alice, { phone: '15551234567' })
      )
    ).id;
    foreignField = (
      await withIdentity(db, bob, (sql) =>
        createCustomField(sql, bob, 'Foreign')
      )
    ).id;
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  const as = <T>(id: string, work: (sql: PGlite) => Promise<T>) =>
    withIdentity(db, id, work);

  it('manages field definitions and rejects foreign field/contact combinations atomically', async () => {
    const field = await as(alice, (sql) =>
      createCustomField(sql, alice, 'Order number')
    );
    expect(await as(bob, (sql) => listCustomFields(sql, accountId))).toEqual(
      []
    );
    expect(
      await as(bob, (sql) =>
        renameCustomField(sql, accountId, field.id, 'Foreign rename')
      )
    ).toBe(false);
    expect(
      await as(alice, (sql) =>
        renameCustomField(sql, accountId, field.id, 'Order ID')
      )
    ).toBe(true);
    await as(alice, (sql) =>
      setCustomValues(sql, accountId, contactId, { [field.id]: 'ORD-123' })
    );
    await expect(
      as(alice, (sql) =>
        setCustomValues(sql, accountId, contactId, {
          [field.id]: 'Changed',
          [foreignField]: 'Foreign',
        })
      )
    ).rejects.toThrow(/not found/);
    expect(
      (await as(alice, (sql) => getCustomValues(sql, accountId, contactId)))[0]
        .value
    ).toBe('ORD-123');
    expect(
      await as(bob, (sql) => getCustomValues(sql, accountId, contactId))
    ).toEqual([]);
    expect(
      await as(alice, (sql) => deleteCustomField(sql, accountId, field.id))
    ).toBe(true);
    expect(
      await as(alice, (sql) => getCustomValues(sql, accountId, contactId))
    ).toEqual([]);
  });

  it('scopes note creation, reads, and deletion to the contact account', async () => {
    const note = await as(alice, (sql) =>
      addNote(sql, alice, contactId, 'Customer called.')
    );
    expect(
      await as(bob, (sql) => listNotes(sql, accountId, contactId))
    ).toEqual([]);
    await expect(
      as(bob, (sql) => addNote(sql, bob, contactId, 'Foreign note'))
    ).rejects.toThrow(/not found/);
    expect(
      await as(bob, (sql) => deleteNote(sql, accountId, contactId, note.id))
    ).toBe(false);
    expect(
      await as(alice, (sql) => deleteNote(sql, accountId, contactId, note.id))
    ).toBe(true);
  });
});
