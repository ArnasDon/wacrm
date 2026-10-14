import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import {
  createPipeline,
  listPipelines,
  listStages,
  savePipeline,
  addStage,
  deletePipeline,
} from './pipelines';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
    [alice, 'Alice', 'a@pipelines.test', bob, 'Bob', 'b@pipelines.test']
  );
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('creates default stages atomically, rejects forged stages, and isolates accounts', async () => {
  const account = await withIdentity(db, alice, (sql) =>
    resolveAccount(sql, alice)
  );
  const pipeline = await withIdentity(db, alice, (sql) =>
    createPipeline(sql, alice, 'Sales')
  );
  const stages = await withIdentity(db, alice, (sql) =>
    listStages(sql, account.accountId, pipeline.id)
  );
  expect(stages).toHaveLength(5);
  expect(
    await withIdentity(db, bob, (sql) => listPipelines(sql, account.accountId))
  ).toEqual([]);
  await expect(
    withIdentity(db, bob, (sql) =>
      addStage(sql, account.accountId, pipeline.id, 'Foreign', '#123456')
    )
  ).rejects.toThrow(/not found/i);
  const foreign = await withIdentity(db, bob, (sql) =>
    createPipeline(sql, bob, 'Other')
  );
  const foreignAccount = await withIdentity(db, bob, (sql) =>
    resolveAccount(sql, bob)
  );
  const [foreignStage] = await withIdentity(db, bob, (sql) =>
    listStages(sql, foreignAccount.accountId, foreign.id)
  );
  await expect(
    withIdentity(db, alice, (sql) =>
      savePipeline(sql, account.accountId, pipeline.id, 'Bad rename', [
        ...stages,
        foreignStage,
      ])
    )
  ).rejects.toThrow(/not found/i);
  expect(
    (
      await withIdentity(db, alice, (sql) =>
        listPipelines(sql, account.accountId)
      )
    )[0].name
  ).toBe('Sales');
  await withIdentity(db, alice, (sql) =>
    savePipeline(
      sql,
      account.accountId,
      pipeline.id,
      'Orders',
      stages.reverse()
    )
  );
  expect(
    (
      await withIdentity(db, alice, (sql) =>
        listStages(sql, account.accountId, pipeline.id)
      )
    )[0].id
  ).toBe(stages[0].id);
  expect(
    await withIdentity(db, alice, (sql) =>
      deletePipeline(sql, account.accountId, pipeline.id)
    )
  ).toBe(true);
  expect(
    await withIdentity(db, alice, (sql) =>
      listStages(sql, account.accountId, pipeline.id)
    )
  ).toEqual([]);
});
