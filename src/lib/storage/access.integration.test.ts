import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from '@/lib/db/test-database';
import { withIdentity, resolveAccount } from '@/lib/db/context-core';
import { registerStoredObject, getStoredObject, deleteStoredObject } from '@/lib/db/storage';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query('INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)', [alice, 'Alice', 'a@storage.test', bob, 'Bob', 'b@storage.test']);
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => { await db?.close(); });
it('records ownership and rejects another account reading or deleting an upload', async () => {
  const account = await withIdentity(db, alice, sql => resolveAccount(sql, alice));
  const id = '20000000-0000-4000-8000-000000000001';
  await withIdentity(db, alice, sql => registerStoredObject(sql, alice, { id, bucket: 'chat-media', filename: 'invoice.pdf', mime: 'application/pdf', bytes: 100, is_public: true }));
  expect(await withIdentity(db, alice, sql => getStoredObject(sql, account.accountId, 'chat-media', id))).toMatchObject({ filename: 'invoice.pdf' });
  expect(await withIdentity(db, bob, sql => getStoredObject(sql, account.accountId, 'chat-media', id))).toBeNull();
  expect(await withIdentity(db, bob, sql => deleteStoredObject(sql, account.accountId, 'chat-media', id))).toBeNull();
  expect(await withIdentity(db, alice, sql => deleteStoredObject(sql, account.accountId, 'chat-media', id))).toMatchObject({ id });
});
