import { beforeAll, afterAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { transaction } from './transaction';
import {
  resolveInboundThread,
  insertInboundMessage,
  saveInboundReaction,
  updateInboundStatus,
  readInboundMediaToken,
} from './inbound';
import { applyTemplateEvent } from './template-events';
let db: PGlite;
let account: string;
let other: string;
const user = '10000000-0000-4000-8000-000000000001';
const identity = {
  phone: '15551234567',
  waUserId: 'US.123456',
  waParentUserId: null,
  waUsername: null,
  name: 'Customer',
};
it('preserves a BSUID thread when its revealed phone belongs to another contact', async () => {
  const first = await transaction(db, (sql) =>
    resolveInboundThread(sql, account, user, {
      ...identity,
      phone: '',
      waUserId: 'US.collision',
    })
  );
  await db.query(
    "INSERT INTO public.contacts(account_id,user_id,phone,name) VALUES($1,$2,'15559990000','Existing phone')",
    [account, user]
  );
  const resolved = await transaction(db, (sql) =>
    resolveInboundThread(sql, account, user, {
      ...identity,
      phone: '15559990000',
      waUserId: 'US.collision',
    })
  );
  expect(resolved.contactId).toBe(first.contactId);
  expect(resolved.conversationId).toBe(first.conversationId);
  expect(
    (
      await db.query<{phone:string}>('SELECT phone FROM public.contacts WHERE id=$1', [
        first.contactId,
      ])
    ).rows[0].phone
  ).toBe('');
});
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','inbound@test.local'),('10000000-0000-4000-8000-000000000002','Other','otherinbound@test.local')",
    [user]
  );
  const rows = (
    await db.query<{ account_id: string }>(
      'SELECT account_id FROM public.profiles ORDER BY user_id'
    )
  ).rows;
  account = rows[0].account_id;
  other = rows[1].account_id;
  await db.exec('SET ROLE omni_worker');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('deduplicates identities and messages, increments unread once, and reopens closed threads', async () => {
  const thread = await transaction(db, (sql) =>
    resolveInboundThread(sql, account, user, identity)
  );
  const again = await transaction(db, (sql) =>
    resolveInboundThread(sql, account, user, { ...identity, phone: '' })
  );
  expect(thread.contactCreated).toBe(true);
  expect(again).toMatchObject({
    contactId: thread.contactId,
    conversationId: thread.conversationId,
    contactCreated: false,
    conversationCreated: false,
  });
  await db.query(
    "UPDATE public.conversations SET status='closed' WHERE id=$1",
    [thread.conversationId]
  );
  const message = {
    metaId: 'wamid.inbound',
    timestamp: new Date().toISOString(),
    contentType: 'text',
    text: 'Order status',
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
    replyMetaId: null,
  };
  const first = await transaction(db, (sql) =>
    insertInboundMessage(sql, account, thread.conversationId, message)
  );
  expect(first).toMatchObject({ firstInbound: true });
  expect(
    await transaction(db, (sql) =>
      insertInboundMessage(sql, account, thread.conversationId, message)
    )
  ).toBeNull();
  expect(
    (
      await db.query(
        'SELECT unread_count,status FROM public.conversations WHERE id=$1',
        [thread.conversationId]
      )
    ).rows[0]
  ).toMatchObject({ unread_count: 1, status: 'open' });
  await expect(
    transaction(db, (sql) =>
      insertInboundMessage(sql, other, thread.conversationId, {
        ...message,
        metaId: 'forged',
      })
    )
  ).rejects.toThrow();
  await transaction(db, (sql) =>
    saveInboundReaction(
      sql,
      account,
      thread.conversationId,
      thread.contactId,
      'wamid.inbound',
      '👍'
    )
  );
  expect(
    (await db.query('SELECT emoji FROM public.message_reactions')).rows
  ).toEqual([{ emoji: '👍' }]);
  await transaction(db, (sql) =>
    saveInboundReaction(
      sql,
      other,
      thread.conversationId,
      thread.contactId,
      'wamid.inbound',
      '❌'
    )
  );
  expect(
    (await db.query('SELECT emoji FROM public.message_reactions')).rows
  ).toEqual([{ emoji: '👍' }]);
  await transaction(db, (sql) =>
    saveInboundReaction(
      sql,
      account,
      thread.conversationId,
      thread.contactId,
      'wamid.inbound',
      ''
    )
  );
  expect(
    (await db.query('SELECT * FROM public.message_reactions')).rows
  ).toEqual([]);
});
it('scopes identical Meta IDs to the receiving account and prevents status regression', async () => {
  const thread = await transaction(db, (sql) =>
    resolveInboundThread(
      sql,
      other,
      '10000000-0000-4000-8000-000000000002',
      identity
    )
  );
  await db.query(
    "INSERT INTO public.messages(conversation_id,sender_type,message_id,status) VALUES($1,'agent','wamid.inbound','sent')",
    [thread.conversationId]
  );
  await transaction(db, (sql) =>
    updateInboundStatus(sql, account, {
      id: 'wamid.inbound',
      status: 'read',
      timestamp: '1760000000',
    })
  );
  await transaction(db, (sql) =>
    updateInboundStatus(sql, account, {
      id: 'wamid.inbound',
      status: 'sent',
      timestamp: '1760000001',
    })
  );
  expect(
    (
      await db.query(
        'SELECT status FROM public.messages WHERE conversation_id=$1',
        [thread.conversationId]
      )
    ).rows[0]
  ).toEqual({ status: 'sent' });
  expect(
    (
      await db.query(
        'SELECT m.status FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.account_id=$1',
        [account]
      )
    ).rows[0]
  ).toEqual({ status: 'read' });
});
it('resolves template events by WABA and creates or updates only that account catalog', async () => {
  await db.query(
    "INSERT INTO public.whatsapp_config(account_id,user_id,phone_number_id,waba_id,access_token) VALUES($1,$2,'99991','waba-local','encrypted')",
    [account, user]
  );
  const event = {
    field: 'message_template_status_update',
    wabaId: 'waba-local',
    value: {
      message_template_id: 'meta-1',
      message_template_name: 'order_status',
      message_template_language: 'en_US',
      event: 'REJECTED',
      reason: 'Wrong sample',
    },
  };
  await transaction(db, (sql) => applyTemplateEvent(sql, event));
  await transaction(db, (sql) =>
    applyTemplateEvent(sql, {
      ...event,
      value: { ...event.value, event: 'APPROVED' },
    })
  );
  await transaction(db, (sql) =>
    applyTemplateEvent(sql, {
      field: 'message_template_quality_update',
      wabaId: 'waba-local',
      value: { message_template_id: 'meta-1', new_quality_score: 'green' },
    })
  );
  const rows = (
    await db.query(
      'SELECT account_id,status,rejection_reason,quality_score FROM public.message_templates'
    )
  ).rows;
  expect(rows).toEqual([
    {
      account_id: account,
      status: 'APPROVED',
      rejection_reason: null,
      quality_score: 'GREEN',
    },
  ]);
  await transaction(db, (sql) =>
    applyTemplateEvent(sql, {
      ...event,
      wabaId: 'unknown-waba',
      value: { ...event.value, event: 'REJECTED' },
    })
  );
  expect(
    (await db.query('SELECT status FROM public.message_templates')).rows[0]
  ).toEqual({ status: 'APPROVED' });
});
it('allows proxying only media referenced in the current account inbox', async () => {
  const thread = await transaction(db, (sql) =>
    resolveInboundThread(sql, account, user, identity)
  );
  await db.query(
    "INSERT INTO public.messages(conversation_id,sender_type,media_url) VALUES($1,'customer','/api/whatsapp/media/123456')",
    [thread.conversationId]
  );
  expect(await readInboundMediaToken(db, account, '123456')).toBe('encrypted');
  expect(await readInboundMediaToken(db, account, '654321')).toBeNull();
  expect(await readInboundMediaToken(db, other, '123456')).toBeNull();
});
