import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from '@/lib/db/test-database';
import {
  withIdentity,
  resolveAccount,
  type LocalAccountContext,
} from '@/lib/db/context-core';
import {
  createBroadcast,
  finalizeBroadcastStatus,
  BroadcastError,
} from './broadcast-core';
import { BroadcastStore } from '@/lib/db/broadcasts';
import { transaction } from '@/lib/db/transaction';
vi.mock('./encryption', () => ({ decrypt: () => 'token' }));
let db: PGlite, ctx: LocalAccountContext;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','broadcastcore@test.local')",
    [user]
  );
  ctx = await withIdentity(db, user, (sql) => resolveAccount(sql, user));
  await db.query(
    'INSERT INTO public.whatsapp_config(account_id,user_id,phone_number_id,access_token,waba_id,verify_token) VALUES($1,$2,$3,$4,$5,$6)',
    [ctx.accountId, user, 'phone', 'token', 'business', 'verify']
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('rejects missing template name', async () => {
  await expect(
    createBroadcast(db, ctx.accountId, user, {
      templateName: '',
      recipients: [{ to: '15550000001' }],
    })
  ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
});
it('rejects empty recipient list', async () => {
  await expect(
    createBroadcast(db, ctx.accountId, user, {
      templateName: 'order',
      recipients: [],
    })
  ).rejects.toBeInstanceOf(BroadcastError);
});
it('rejects more than 1000 recipients', async () => {
  await expect(
    createBroadcast(db, ctx.accountId, user, {
      templateName: 'order',
      recipients: Array.from({ length: 1001 }, () => ({ to: '15550000001' })),
    })
  ).rejects.toMatchObject({ status: 400 });
});
it('persists campaign and deduplicated frozen recipient params together', async () => {
  const plan = await transaction(db, (sql) =>
    createBroadcast(sql, ctx.accountId, user, {
      templateName: 'order',
      recipients: [
        { to: '+15550000001', params: ['123'] },
        { to: '15550000001', params: ['duplicate'] },
        { to: 'invalid' },
      ],
    })
  );
  expect(plan.planned).toHaveLength(1);
  expect(plan.planned[0].params).toEqual(['123']);
  expect(plan.rejected).toBe(1);
  expect(
    (await new BroadcastStore(db, ctx.accountId).get(plan.broadcastId))
      ?.delivery_locked_at
  ).toBeTruthy();
});
it('rolls back a campaign when a recipient insertion fails', async () => {
  const store = new BroadcastStore(db, ctx.accountId);
  const before = (await store.list()).length;
  await expect(
    transaction(db, (sql) =>
      new BroadcastStore(sql, ctx.accountId).create(user, {
        name: 'Bad',
        templateName: 'order',
        language: 'en',
        variables: {},
        audience: {},
        recipients: [
          { contactId: '20000000-0000-4000-8000-000000000001', params: [] },
        ],
      })
    )
  ).rejects.toThrow();
  expect((await store.list()).length).toBe(before);
});
for (const [statuses, expected] of [
  [['pending', 'sent'], 'sending'],
  [['failed', 'failed'], 'failed'],
  [['failed', 'sent'], 'sent'],
  [['failed', 'delivered'], 'sent'],
] as const) {
  it('finalizes ' + statuses.join('/') + ' as ' + expected, async () => {
    const store = new BroadcastStore(db, ctx.accountId);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [row] = (
        await db.query<{ id: string }>(
          'INSERT INTO public.contacts(account_id,user_id,phone,name) VALUES($1,$2,$3,$4) RETURNING id',
          [
            ctx.accountId,
            user,
            '1555' +
              String(Math.floor(Math.random() * 10000000)).padStart(7, '0'),
            'Customer',
          ]
        )
      ).rows;
      ids.push(row.id);
    }
    const campaign = await transaction(db, (sql) =>
      new BroadcastStore(sql, ctx.accountId).create(user, {
        name: 'Status',
        templateName: 'order',
        language: 'en',
        variables: {},
        audience: {},
        recipients: ids.map((contactId) => ({ contactId, params: [] })),
      })
    );
    const recipients = await store.recipients(campaign.id);
    for (let i = 0; i < 2; i++)
      await db.query(
        'UPDATE public.broadcast_recipients SET status=$2 WHERE id=$1',
        [recipients[i].id, statuses[i]]
      );
    await finalizeBroadcastStatus(db, campaign.id, ctx.accountId);
    expect((await store.get(campaign.id))?.status).toBe(expected);
  });
}
