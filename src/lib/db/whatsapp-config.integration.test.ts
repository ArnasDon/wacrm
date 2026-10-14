import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import {
  readWhatsAppConfig,
  saveWhatsAppConfig,
  deleteWhatsAppConfig,
} from './whatsapp-config';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
    [alice, 'Alice', 'a@wa.test', bob, 'Bob', 'b@wa.test']
  );
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('upserts account config without losing mirror preference and enforces unique phone ownership', async () => {
  const ctx = await withIdentity(db, alice, (sql) =>
    resolveAccount(sql, alice)
  );
  const input = {
    phone_number_id: '123456789',
    waba_id: '987654321',
    access_token: 'encrypted-token',
    verify_token: null,
    status: 'connected',
    connected_at: null,
    registered_at: null,
    subscribed_apps_at: null,
    last_registration_error: null,
  };
  await withIdentity(db, alice, (sql) => saveWhatsAppConfig(sql, alice, input));
  expect(
    await withIdentity(db, bob, (sql) => readWhatsAppConfig(sql, ctx.accountId))
  ).toBeNull();
  await expect(
    withIdentity(db, bob, (sql) => saveWhatsAppConfig(sql, bob, input))
  ).rejects.toMatchObject({ code: '23505' });
  await withIdentity(db, alice, (sql) =>
    saveWhatsAppConfig(sql, alice, { ...input, waba_id: '555555555' })
  );
  expect(
    await withIdentity(db, alice, (sql) =>
      readWhatsAppConfig(sql, ctx.accountId)
    )
  ).toMatchObject({ waba_id: '555555555', mirror_inbound_media: true });
  await withIdentity(db, bob, (sql) =>
    deleteWhatsAppConfig(sql, ctx.accountId)
  );
  expect(
    await withIdentity(db, alice, (sql) =>
      readWhatsAppConfig(sql, ctx.accountId)
    )
  ).not.toBeNull();
});
