import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import { createContact } from './contacts';
import {
  listConversations,
  getConversation,
  listMessages,
  updateConversation,
} from './inbox';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
let accountId: string;
let conversationId: string;
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
    [alice, 'Alice', 'a@inbox.test', bob, 'Bob', 'b@inbox.test']
  );
  accountId = (
    await db.query<{ account_id: string }>(
      'SELECT account_id FROM public.profiles WHERE user_id=$1',
      [alice]
    )
  ).rows[0].account_id;
  await db.exec('SET ROLE omni_app');
  const contact = await withIdentity(db, alice, (sql) =>
    createContact(sql, alice, { phone: '15551234567', name: 'Customer' })
  );
  conversationId = (
    await withIdentity(db, alice, (sql) =>
      sql.query<{ id: string }>(
        'INSERT INTO public.conversations(user_id,account_id,contact_id) VALUES ($1,$2,$3) RETURNING id',
        [alice, accountId, contact.id]
      )
    )
  ).rows[0].id;
  await withIdentity(db, alice, (sql) =>
    sql.query(
      "INSERT INTO public.messages(conversation_id,sender_type,content_type,content_text) VALUES ($1,'customer','text','Hello')",
      [conversationId]
    )
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('scopes conversation/message reads and prevents assignment outside the account', async () => {
  expect(
    (
      await withIdentity(db, alice, (sql) => listConversations(sql, accountId))
    )[0].contact?.name
  ).toBe('Customer');
  expect(
    (
      await withIdentity(db, alice, (sql) =>
        listMessages(sql, accountId, conversationId)
      )
    )[0].content_text
  ).toBe('Hello');
  expect(
    await withIdentity(db, bob, (sql) =>
      getConversation(sql, accountId, conversationId)
    )
  ).toBeNull();
  expect(
    await withIdentity(db, bob, (sql) =>
      listMessages(sql, accountId, conversationId)
    )
  ).toEqual([]);
  await expect(
    withIdentity(db, alice, (sql) =>
      updateConversation(sql, accountId, conversationId, {
        assigned_agent_id: bob,
      })
    )
  ).rejects.toThrow(/not found/i);
  await withIdentity(db, alice, (sql) =>
    updateConversation(sql, accountId, conversationId, {
      status: 'closed',
      unread_count: 0,
    })
  );
  expect(
    await withIdentity(db, alice, (sql) =>
      getConversation(sql, accountId, conversationId)
    )
  ).toMatchObject({ status: 'closed', unread_count: 0 });
  expect(
    (await withIdentity(db, bob, (sql) => resolveAccount(sql, bob))).accountId
  ).not.toBe(accountId);
});
it('assigns a conversation using the responder user ID, not the profile row ID', async () => {
  const result = await withIdentity(db, alice, (sql) =>
    updateConversation(sql, accountId, conversationId, {
      assigned_agent_id: alice,
    })
  );
  expect(result?.assigned_agent_id).toBe(alice);
});
