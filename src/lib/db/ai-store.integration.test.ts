import { beforeAll, afterAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import {
  withIdentity,
  resolveAccount,
  type LocalAccountContext,
} from './context-core';
import { AiStore } from './ai-store';
let db: PGlite;
let ctx: LocalAccountContext;
let other: LocalAccountContext;
const user = '10000000-0000-4000-8000-000000000001',
  stranger = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = await createTestDatabase();
  for (const id of [user, stranger])
    await db.query(
      "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner',$2)",
      [id, id + '@ai.test']
    );
  ctx = await withIdentity(db, user, (sql) => resolveAccount(sql, user));
  other = await withIdentity(db, stranger, (sql) =>
    resolveAccount(sql, stranger)
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('isolates knowledge and ranks real-array embeddings without a hosted extension', async () => {
  const store = new AiStore(db, ctx.accountId);
  const foreign = new AiStore(db, other.accountId);
  const doc = await store.createDocument(
    user,
    'Orders',
    'Order status delivery'
  );
  await store.replaceChunks(doc.id, doc.content, [
    { content: 'Order status delivery', embedding: [1, 0] },
    { content: 'Returns refunds', embedding: [0, 1] },
  ]);
  expect((await store.semantic([1, 0], 1))[0].content).toBe(
    'Order status delivery'
  );
  expect((await store.lexical('delivery', 5))[0].content).toBe(
    'Order status delivery'
  );
  expect(await foreign.document(doc.id)).toBeNull();
  await expect(
    foreign.replaceChunks(doc.id, doc.content, [])
  ).rejects.toThrow();
  await store.updateDocument(doc.id, { content: 'New status' });
  await expect(store.replaceChunks(doc.id, doc.content, [])).rejects.toThrow(
    'changed'
  );
  expect(await store.hasChunks()).toBe(false);
});
it('claims reply slots only for eligible account conversations and preserves human assignments', async () => {
  expect(await new AiStore(db, ctx.accountId).member(user)).toBe(true);
  const [contact] = (
    await db.query<{ id: string }>(
      "INSERT INTO public.contacts(account_id,user_id,name,phone) VALUES($1,$2,'Customer','15550000001') RETURNING id",
      [ctx.accountId, user]
    )
  ).rows;
  const [conversation] = (
    await db.query<{ id: string }>(
      'INSERT INTO public.conversations(account_id,user_id,contact_id) VALUES($1,$2,$3) RETURNING id',
      [ctx.accountId, user, contact.id]
    )
  ).rows;
  const store = new AiStore(db, ctx.accountId),
    foreign = new AiStore(db, other.accountId);
  expect(await foreign.claim(conversation.id, 2)).toBe(false);
  expect(await store.claim(conversation.id, 2)).toBe(true);
  expect(await store.claim(conversation.id, 2)).toBe(true);
  expect(await store.claim(conversation.id, 2)).toBe(false);
  await db.query(
    'UPDATE public.conversations SET assigned_agent_id=$2 WHERE id=$1',
    [conversation.id, user]
  );
  await store.handoff(conversation.id, 'Needs help', stranger);
  expect((await store.conversation(conversation.id))?.assigned_agent_id).toBe(
    user
  );
  expect(await store.claim(conversation.id, 20)).toBe(false);
});
