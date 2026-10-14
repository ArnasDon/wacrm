import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import { createContact } from './contacts';
import { dashboardMetrics, dashboardActivity } from './dashboard';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
    [alice, 'Alice', 'a@dash.test', bob, 'Bob', 'b@dash.test']
  );
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('counts only account records and scopes joined activity', async () => {
  const ctx = await withIdentity(db, alice, (sql) =>
    resolveAccount(sql, alice)
  );
  await withIdentity(db, alice, (sql) =>
    createContact(sql, alice, { phone: '15551234567', name: 'Alice customer' })
  );
  await withIdentity(db, bob, (sql) =>
    createContact(sql, bob, { phone: '15557654321', name: 'Bob customer' })
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const metrics = await withIdentity(db, alice, (sql) =>
    dashboardMetrics(
      sql,
      ctx.accountId,
      today.toISOString(),
      yesterday.toISOString()
    )
  );
  expect(metrics.newContactsToday.current).toBe(1);
  expect(metrics.openDealsValue).toBe(0);
  const activity = await withIdentity(db, alice, (sql) =>
    dashboardActivity(sql, ctx.accountId)
  );
  expect(activity.contacts.data).toHaveLength(1);
  expect(JSON.stringify(activity)).not.toContain('Bob customer');
  const foreign = await withIdentity(db, bob, (sql) =>
    dashboardActivity(sql, ctx.accountId)
  );
  expect(foreign.contacts.data).toEqual([]);
});
