import { beforeAll, afterAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import {
  withIdentity,
  resolveAccount,
  type LocalAccountContext,
} from './context-core';
import {
  createQuickReply,
  updateQuickReply,
  listQuickReplies,
} from './quick-replies';
let db: PGlite;
let ctx: LocalAccountContext;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','quickreply@test.local')",
    [user]
  );
  ctx = await withIdentity(db, user, (sql) => resolveAccount(sql, user));
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('validates snippets and clears the old representation when switching kind', async () => {
  const row = await withIdentity(db, user, (sql) =>
    createQuickReply(sql, ctx, {
      title: 'Order',
      kind: 'text',
      content_text: 'Order number?',
    })
  );
  await withIdentity(db, user, (sql) =>
    updateQuickReply(sql, ctx.accountId, row.id, {
      kind: 'interactive',
      interactive_payload: {
        kind: 'buttons',
        body: 'Choose',
        buttons: [{ id: 'status', title: 'Status' }],
      },
    })
  );
  expect(
    (
      await withIdentity(db, user, (sql) =>
        listQuickReplies(sql, ctx.accountId)
      )
    )[0]
  ).toMatchObject({ kind: 'interactive', content_text: null });
  await expect(
    withIdentity(db, user, (sql) =>
      updateQuickReply(sql, ctx.accountId, row.id, {
        kind: 'text',
        content_text: '',
      })
    )
  ).rejects.toThrow();
  await withIdentity(db, user, (sql) =>
    updateQuickReply(sql, ctx.accountId, row.id, {
      kind: 'text',
      content_text: 'Hello',
    })
  );
  expect(
    (
      await withIdentity(db, user, (sql) =>
        listQuickReplies(sql, ctx.accountId)
      )
    )[0]
  ).toMatchObject({ kind: 'text', interactive_payload: null });
});
