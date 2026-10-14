import { beforeAll, afterAll, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import {
  withIdentity,
  resolveAccount,
  type LocalAccountContext,
} from './context-core';
import { BroadcastStore } from './broadcasts';
let db: PGlite, ctx: LocalAccountContext;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','broadcast@test.local')",
    [user]
  );
  ctx = await withIdentity(db, user, (sql) => resolveAccount(sql, user));
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('persists frozen parameters atomically and scopes claims and delivery updates', async () => {
  const [contact] = (
    await db.query<{ id: string }>(
      "INSERT INTO public.contacts(account_id,user_id,phone,name) VALUES($1,$2,'15550000001','Customer') RETURNING id",
      [ctx.accountId, user]
    )
  ).rows;
  const store = new BroadcastStore(db, ctx.accountId),
    foreign = new BroadcastStore(db, '20000000-0000-4000-8000-000000000001');
  const created = await store.create(user, {
    name: 'Orders',
    templateName: 'order',
    language: 'en',
    recipients: [{ contactId: contact.id, params: ['1234'] }],
    variables: {},
    audience: { headerMediaUrl: 'https://example.com/header.png' },
  });
  const recipients = await store.recipients(created.id);
  expect(recipients[0].template_params).toEqual(['1234']);
  expect(await foreign.get(created.id)).toBeNull();
  expect(await foreign.claim(created.id)).toBe(false);
  expect(await store.claim(created.id)).toBe(true);
  expect(await store.claim(created.id)).toBe(false);
  await foreign.stamp(created.id, recipients[0].id, 'wamid.invalid', null);
  expect((await store.recipients(created.id))[0].status).toBe('pending');
  await store.stamp(created.id, recipients[0].id, 'wamid.sent', null);
  await store.finalize(created.id);
  expect(await store.get(created.id)).toMatchObject({
    status: 'sent',
    sent_count: 1,
  });
  await db.query('DELETE FROM public.contacts WHERE id=$1', [contact.id]);
  expect(await store.recipients(created.id)).toHaveLength(1);
});
