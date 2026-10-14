import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import { createContact } from './contacts';
import { createPipeline, listStages } from './pipelines';
import { saveDeal, listDeals, deleteDeal } from './deals';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
    [alice, 'Alice', 'a@deals.test', bob, 'Bob', 'b@deals.test']
  );
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('validates related records, persists status and value, and denies foreign mutations', async () => {
  const ctx = await withIdentity(db, alice, (sql) =>
    resolveAccount(sql, alice)
  );
  const pipeline = await withIdentity(db, alice, (sql) =>
    createPipeline(sql, alice, 'Sales')
  );
  const stages = await withIdentity(db, alice, (sql) =>
    listStages(sql, ctx.accountId, pipeline.id)
  );
  const contact = await withIdentity(db, alice, (sql) =>
    createContact(sql, alice, { phone: '15551234567' })
  );
  const foreign = await withIdentity(db, bob, (sql) =>
    createContact(sql, bob, { phone: '15557654321' })
  );
  const payload = {
    title: 'Order',
    pipeline_id: pipeline.id,
    stage_id: stages[0].id,
    contact_id: contact.id,
    value: 12.5,
    currency: 'USD',
  };
  const deal = await withIdentity(db, alice, (sql) =>
    saveDeal(sql, alice, null, payload)
  );
  await expect(
    withIdentity(db, alice, (sql) =>
      saveDeal(sql, alice, deal.id, { contact_id: foreign.id })
    )
  ).rejects.toThrow(/not found/i);
  await expect(
    withIdentity(db, bob, (sql) =>
      saveDeal(sql, bob, deal.id, { title: 'Foreign' })
    )
  ).rejects.toThrow(/not found/i);
  await withIdentity(db, alice, (sql) =>
    saveDeal(sql, alice, deal.id, { status: 'won', stage_id: stages[4].id })
  );
  const [loaded] = await withIdentity(db, alice, (sql) =>
    listDeals(sql, ctx.accountId, pipeline.id)
  );
  expect(loaded).toMatchObject({
    status: 'won',
    value: 12.5,
    contact: { id: contact.id },
  });
  expect(
    await withIdentity(db, bob, (sql) =>
      deleteDeal(sql, ctx.accountId, deal.id)
    )
  ).toBe(false);
  expect(
    await withIdentity(db, alice, (sql) =>
      deleteDeal(sql, ctx.accountId, deal.id)
    )
  ).toBe(true);
});
