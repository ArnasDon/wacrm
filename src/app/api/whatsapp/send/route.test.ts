import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from '@/lib/db/test-database';
import {
  withIdentity,
  resolveAccount,
  type LocalAccountContext,
} from '@/lib/db/context-core';
import type { SqlConnection } from '@/lib/db/transaction';
const h = vi.hoisted(() => ({
  db: null as PGlite | null,
  ctx: null as LocalAccountContext | null,
  role: 'owner',
  send: vi.fn(),
}));
vi.mock('@/lib/db/context', () => ({
  getLocalAccountContext: async () => ({ ...h.ctx, role: h.role }),
  withAccount: async (
    _ctx: unknown,
    work: (db: SqlConnection) => Promise<unknown>
  ) => withIdentity(h.db!, h.ctx!.userId, work),
}));
vi.mock('@/lib/whatsapp/send-message-local', () => ({
  sendLocalMessage: h.send,
}));
import { POST } from './route';
const user = '10000000-0000-4000-8000-000000000001';
let contactId: string;
beforeAll(async () => {
  h.db = await createTestDatabase();
  await h.db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','sendroute@test.local')",
    [user]
  );
  h.ctx = await withIdentity(h.db, user, (sql) => resolveAccount(sql, user));
}, 30000);
afterAll(async () => {
  await h.db?.close();
});
beforeEach(async () => {
  await h.db!.query('DELETE FROM public.conversations');
  await h.db!.query('DELETE FROM public.contacts');
  contactId = (
    await h.db!.query<{ id: string }>(
      'INSERT INTO public.contacts(account_id,user_id,phone,name) VALUES($1,$2,$3,$4) RETURNING id',
      [h.ctx!.accountId, user, '15550000001', 'Customer']
    )
  ).rows[0].id;
  h.role = 'owner';
  h.send
    .mockReset()
    .mockResolvedValue({
      messageId: 'local-message',
      whatsappMessageId: 'wamid.sent',
    });
});
function post(
  overrides: Record<string, unknown> = {},
  origin = 'http://localhost'
) {
  return POST(
    new Request('http://localhost/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        contact_id: contactId,
        message_type: 'template',
        template_name: 'order_update',
        template_language: 'en_US',
        template_params: ['1234'],
        ...overrides,
      }),
    })
  );
}
it('creates a conversation for the owned contact and sends the template', async () => {
  const response = await post();
  expect(response.status).toBe(200);
  const rows = (
    await h.db!.query<{ id: string; contact_id: string }>(
      'SELECT id,contact_id FROM public.conversations'
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].contact_id).toBe(contactId);
  expect(h.send).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: h.ctx!.accountId }),
    expect.objectContaining({
      conversationId: rows[0].id,
      templateParams: ['1234'],
    })
  );
});
it('reuses an existing conversation', async () => {
  const id = (
    await h.db!.query<{ id: string }>(
      'INSERT INTO public.conversations(account_id,user_id,contact_id) VALUES($1,$2,$3) RETURNING id',
      [h.ctx!.accountId, user, contactId]
    )
  ).rows[0].id;
  expect((await post()).status).toBe(200);
  expect(h.send.mock.calls[0][1].conversationId).toBe(id);
  expect(
    (await h.db!.query('SELECT id FROM public.conversations')).rows
  ).toHaveLength(1);
});
it('rejects a foreign or missing contact', async () => {
  expect(
    (await post({ contact_id: '20000000-0000-4000-8000-000000000001' })).status
  ).toBe(404);
  expect(h.send).not.toHaveBeenCalled();
});
it('requires a conversation or contact', async () => {
  expect((await post({ contact_id: undefined })).status).toBe(400);
  expect(h.send).not.toHaveBeenCalled();
});
it('refuses viewers before any send', async () => {
  h.role = 'viewer';
  expect((await post()).status).toBe(403);
  expect(h.send).not.toHaveBeenCalled();
});
it('allows agents', async () => {
  h.role = 'agent';
  expect((await post()).status).toBe(200);
  expect(h.send).toHaveBeenCalledOnce();
});
it('rejects a cross-origin send', async () => {
  expect((await post({}, 'https://attacker.invalid')).status).toBe(403);
  expect(h.send).not.toHaveBeenCalled();
});
