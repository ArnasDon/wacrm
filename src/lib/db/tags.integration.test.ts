import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import { createTag, deleteTag, listTags } from './tags';

let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
    [alice, 'Alice', 'a@tags.test', bob, 'Bob', 'b@tags.test']
  );
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('creates account-owned tags and prevents another account reading or deleting them', async () => {
  const account = await withIdentity(db, alice, (sql) =>
    resolveAccount(sql, alice)
  );
  const tag = await withIdentity(db, alice, (sql) =>
    createTag(sql, alice, 'Orders', '#10b981')
  );
  expect(tag.account_id).toBe(account.accountId);
  expect(
    await withIdentity(db, bob, (sql) => listTags(sql, account.accountId))
  ).toEqual([]);
  expect(
    await withIdentity(db, bob, (sql) =>
      deleteTag(sql, account.accountId, tag.id)
    )
  ).toBe(false);
  expect(
    (
      await withIdentity(db, alice, (sql) => listTags(sql, account.accountId))
    ).map((t) => t.name)
  ).toEqual(['Orders']);
  expect(
    await withIdentity(db, alice, (sql) =>
      deleteTag(sql, account.accountId, tag.id)
    )
  ).toBe(true);
});
