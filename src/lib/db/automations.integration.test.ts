import { beforeAll, afterAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import {
  withIdentity,
  resolveAccount,
  type LocalAccountContext,
} from './context-core';
import {
  createAutomation,
  readAutomation,
  updateAutomation,
  duplicateAutomation,
} from './automations';
let db: PGlite;
let ctx: LocalAccountContext;
let other: LocalAccountContext;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','autocrud@test.local'),('10000000-0000-4000-8000-000000000002','Other','otherautocrud@test.local')",
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
it('saves and copies nested steps transactionally within the account', async () => {
  const original = await withIdentity(db, user, (sql) =>
    createAutomation(sql, ctx, {
      name: 'Orders',
      trigger_type: 'new_message_received',
      steps: [
        {
          step_type: 'condition',
          step_config: { subject: 'message_content', value: 'order' },
          branches: {
            yes: [{ step_type: 'close_conversation', step_config: {} }],
            no: [],
          },
        },
      ],
    })
  );
  const graph = await withIdentity(db, user, (sql) =>
    readAutomation(sql, ctx.accountId, original.id)
  );
  expect(graph?.steps[0].branches.yes[0].step_type).toBe('close_conversation');
  expect(
    await withIdentity(db, other.userId, (sql) =>
      readAutomation(sql, other.accountId, original.id)
    )
  ).toBeNull();
  const copy = await withIdentity(db, user, (sql) =>
    duplicateAutomation(sql, ctx, original.id)
  );
  const copied = await withIdentity(db, user, (sql) =>
    readAutomation(sql, ctx.accountId, copy!.id)
  );
  expect(copied?.steps[0].id).not.toBe(graph?.steps[0].id);
  expect(copied?.steps[0].branches.yes.length).toBe(1);
  await expect(
    withIdentity(db, user, (sql) =>
      updateAutomation(sql, ctx.accountId, original.id, {
        name: 'Broken',
        steps: [
          {
            step_type: 'condition',
            step_config: {},
            branches: { yes: 'bad' as never },
          },
        ],
      })
    )
  ).rejects.toThrow();
  expect(
    (
      await withIdentity(db, user, (sql) =>
        readAutomation(sql, ctx.accountId, original.id)
      )
    )?.automation.name
  ).toBe('Orders');
});
