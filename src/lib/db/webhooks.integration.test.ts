import { beforeAll, afterAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import {
  createWebhook,
  listWebhooks,
  updateWebhook,
  deleteWebhook,
  recordWebhookFailure,
} from './webhooks';
let db: PGlite;
let account: string;
let other: string;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','hooks@test.local'),('10000000-0000-4000-8000-000000000002','Other','otherhooks@test.local')",
    [user]
  );
  const rows = (
    await db.query<{ account_id: string; user_id: string }>(
      'SELECT account_id,user_id FROM public.profiles ORDER BY user_id'
    )
  ).rows;
  account = rows[0].account_id;
  other = rows[1].account_id;
  await db.exec('SET ROLE omni_worker');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('keeps secrets private and scopes management and delivery counters to the account', async () => {
  const created = await createWebhook(db, account, user, {
    url: 'https://example.com/hook',
    secret: 'encrypted',
    events: ['message.received'],
  });
  expect(created).not.toHaveProperty('secret');
  expect(await listWebhooks(db, other)).toEqual([]);
  expect(
    await updateWebhook(db, other, created.id, { url: 'https://wrong.example' })
  ).toBeNull();
  expect(await deleteWebhook(db, other, created.id)).toBeNull();
  await recordWebhookFailure(db, other, created.id, 15);
  expect((await listWebhooks(db, account))[0].failure_count).toBe(0);
  for (let i = 0; i < 15; i++)
    await recordWebhookFailure(db, account, created.id, 15);
  expect((await listWebhooks(db, account))[0]).toMatchObject({
    failure_count: 15,
    is_active: false,
  });
  expect(
    await updateWebhook(db, account, created.id, { is_active: true })
  ).toMatchObject({ failure_count: 0, is_active: true });
  expect(await deleteWebhook(db, account, created.id)).toEqual({
    id: created.id,
  });
});
