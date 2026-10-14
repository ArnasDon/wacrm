import { beforeAll, afterAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import {
  authorizeApiOperation,
  findOrCreateApiContact,
  getApiContact,
  listApiContacts,
  replaceApiTags,
  resolveApiConversation,
  listApiMessages,
} from './public-api';
import { transaction } from './transaction';
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
let db: PGlite;
let accountId: string;
let otherAccountId: string;
let keyId: string;
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES($1,$2,$3),($4,$5,$6)',
    [alice, 'Alice', 'alice@public.test', bob, 'Bob', 'bob@public.test']
  );
  accountId = (
    await db.query<{ account_id: string }>(
      'SELECT account_id FROM public.profiles WHERE user_id=$1',
      [alice]
    )
  ).rows[0].account_id;
  otherAccountId = (
    await db.query<{ account_id: string }>(
      'SELECT account_id FROM public.profiles WHERE user_id=$1',
      [bob]
    )
  ).rows[0].account_id;
  keyId = (
    await db.query<{ id: string }>(
      "INSERT INTO public.api_keys(account_id,created_by,name,key_prefix,key_hash,scopes) VALUES($1,$2,'Test','test','test-hash',ARRAY['contacts:write','contacts:read','messages:send','messages:read']) RETURNING id",
      [accountId, alice]
    )
  ).rows[0].id;
  await db.exec('SET ROLE omni_worker');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('checks current key scope/account and rejects revoked keys', async () => {
  expect(
    await authorizeApiOperation(db, { keyId, accountId }, 'contacts:write')
  ).toMatchObject({ auditUserId: alice });
  await expect(
    authorizeApiOperation(
      db,
      { keyId, accountId: otherAccountId },
      'contacts:read'
    )
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    authorizeApiOperation(db, { keyId, accountId }, 'webhooks:manage')
  ).rejects.toMatchObject({ status: 403 });
  await db.query('UPDATE public.api_keys SET revoked_at=now() WHERE id=$1', [
    keyId,
  ]);
  await expect(
    authorizeApiOperation(db, { keyId, accountId }, 'contacts:read')
  ).rejects.toMatchObject({ status: 401 });
  await db.query('UPDATE public.api_keys SET revoked_at=NULL WHERE id=$1', [
    keyId,
  ]);
});
it('creates/deduplicates contacts and replaces only requested tags atomically', async () => {
  const input = { phone: '+15551234567', name: 'Customer' };
  const first = await transaction(db, (sql) =>
    findOrCreateApiContact(sql, accountId, alice, input)
  );
  const duplicate = await transaction(db, (sql) =>
    findOrCreateApiContact(sql, accountId, alice, input)
  );
  expect(first.created).toBe(true);
  expect(duplicate).toMatchObject({ id: first.id, created: false });
  await transaction(db, (sql) =>
    replaceApiTags(sql, accountId, alice, first.id, ['VIP', 'Order'])
  );
  await transaction(db, (sql) =>
    replaceApiTags(sql, accountId, alice, first.id, ['vip'])
  );
  expect(
    (await getApiContact(db, accountId, first.id))?.tags.map((tag) => tag.name)
  ).toEqual(['VIP']);
  expect(await getApiContact(db, otherAccountId, first.id)).toBeNull();
  expect(
    await listApiContacts(db, otherAccountId, { limit: 10, cursor: null })
  ).toEqual([]);
  await expect(
    transaction(db, (sql) =>
      replaceApiTags(sql, otherAccountId, bob, first.id, ['Forged'])
    )
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await getApiContact(db, accountId, first.id))?.tags.map((tag) => tag.name)
  ).toEqual(['VIP']);
});
it('requires WhatsApp configuration before creating a send contact, then reuses its conversation', async () => {
  await expect(
    transaction(db, (sql) =>
      resolveApiConversation(sql, accountId, alice, '+15559876543', null)
    )
  ).rejects.toMatchObject({ status: 400 });
  expect(
    (await listApiContacts(db, accountId, { limit: 10, cursor: null })).length
  ).toBe(1);
  await db.query(
    "INSERT INTO public.whatsapp_config(user_id,account_id,phone_number_id,access_token) VALUES($1,$2,'123456789','encrypted')",
    [alice, accountId]
  );
  const resolved = await transaction(db, (sql) =>
    resolveApiConversation(sql, accountId, alice, '+15559876543', 'Buyer')
  );
  const again = await transaction(db, (sql) =>
    resolveApiConversation(sql, accountId, alice, '+15559876543', null)
  );
  expect(again.conversationId).toBe(resolved.conversationId);
  await db.query(
    "INSERT INTO public.messages(conversation_id,sender_type,content_text) VALUES($1,'customer','Hello')",
    [resolved.conversationId]
  );
  expect(
    (
      await listApiMessages(db, accountId, resolved.conversationId, {
        limit: 10,
        cursor: null,
      })
    )[0].content_text
  ).toBe('Hello');
  await expect(
    listApiMessages(db, otherAccountId, resolved.conversationId, {
      limit: 10,
      cursor: null,
    })
  ).rejects.toMatchObject({ status: 404 });
});
