import { beforeAll, afterAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import {
  withIdentity,
  resolveAccount,
  type LocalAccountContext,
} from './context-core';
import { createFlow, updateFlow, readFlow, listFlows } from './flows';
let db: PGlite;
let ctx: LocalAccountContext;
let other: LocalAccountContext;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','flowscrud@test.local'),('10000000-0000-4000-8000-000000000002','Other','otherflowscrud@test.local')",
    [user]
  );
  ctx = await withIdentity(db, user, (sql) => resolveAccount(sql, user));
  other = await withIdentity(
    db,
    '10000000-0000-4000-8000-000000000002',
    (sql) => resolveAccount(sql, '10000000-0000-4000-8000-000000000002')
  );
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('creates and updates graphs atomically with account isolation', async () => {
  const flow = await withIdentity(db, user, (sql) =>
    createFlow(sql, ctx, {
      name: 'Orders',
      trigger_type: 'keyword',
      trigger_config: { keywords: ['order'] },
      nodes: [
        {
          node_key: 'start',
          node_type: 'start',
          config: { next_node_key: 'done' },
        },
        { node_key: 'done', node_type: 'end', config: {} },
      ],
      entry_node_id: 'start',
    })
  );
  expect(
    await withIdentity(db, other.userId, (sql) =>
      listFlows(sql, other.accountId)
    )
  ).toEqual([]);
  expect(
    await withIdentity(db, other.userId, (sql) =>
      readFlow(sql, other.accountId, flow.id)
    )
  ).toBeNull();
  await expect(
    withIdentity(db, user, (sql) =>
      updateFlow(sql, ctx.accountId, flow.id, {
        name: 'Broken',
        nodes: [
          { node_key: 'same', node_type: 'end', config: {} },
          { node_key: 'same', node_type: 'end', config: {} },
        ],
      })
    )
  ).rejects.toThrow();
  const graph = await withIdentity(db, user, (sql) =>
    readFlow(sql, ctx.accountId, flow.id)
  );
  expect(graph?.flow.name).toBe('Orders');
  expect(graph?.nodes.length).toBe(2);
  expect(
    (
      await withIdentity(db, user, (sql) =>
        updateFlow(sql, ctx.accountId, flow.id, { name: 'Updated' })
      )
    )?.flow.name
  ).toBe('Updated');
});
