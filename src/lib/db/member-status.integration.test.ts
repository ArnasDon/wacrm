import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import {
  listPresence,
  touchPresence,
  listNotifications,
  markNotificationsRead,
  unreadCounts,
} from './member-status';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
let accountId: string;
let notificationId: string;
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
    [alice, 'Alice', 'a@status.test', bob, 'Bob', 'b@status.test']
  );
  accountId = (
    await db.query<{ account_id: string }>(
      'SELECT account_id FROM public.profiles WHERE user_id=$1',
      [alice]
    )
  ).rows[0].account_id;
  notificationId = (
    await db.query<{ id: string }>(
      "INSERT INTO public.notifications(account_id,user_id,title) VALUES ($1,$2,'Assigned') RETURNING id",
      [accountId, alice]
    )
  ).rows[0].id;
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('writes only caller presence and scopes notification reads/updates', async () => {
  await withIdentity(db, alice, (sql) => touchPresence(sql, 'online'));
  expect(
    (await withIdentity(db, alice, (sql) => listPresence(sql, accountId)))[0]
      .user_id
  ).toBe(alice);
  expect(
    await withIdentity(db, bob, (sql) => listPresence(sql, accountId))
  ).toEqual([]);
  expect(
    (
      await withIdentity(db, alice, (sql) =>
        unreadCounts(sql, accountId, alice)
      )
    ).notifications
  ).toBe(1);
  expect(
    await withIdentity(db, bob, (sql) => listNotifications(sql, accountId, bob))
  ).toEqual([]);
  expect(
    await withIdentity(db, bob, (sql) =>
      markNotificationsRead(sql, accountId, bob, notificationId)
    )
  ).toBe(0);
  expect(
    await withIdentity(db, alice, (sql) =>
      markNotificationsRead(sql, accountId, alice, notificationId)
    )
  ).toBe(1);
  expect(
    (
      await withIdentity(db, alice, (sql) =>
        unreadCounts(sql, accountId, alice)
      )
    ).notifications
  ).toBe(0);
  expect(
    (await withIdentity(db, bob, (sql) => resolveAccount(sql, bob))).accountId
  ).not.toBe(accountId);
});
