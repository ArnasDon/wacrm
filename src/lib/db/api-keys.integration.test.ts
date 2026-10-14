import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import { mintKey, listKeys, revokeKey, findKey } from './api-keys';
import { hashApiKey } from '@/lib/api-keys/keys';

describe('local API keys', () => {
  let db: PGlite;
  const alice = '10000000-0000-4000-8000-000000000001';
  const bob = '10000000-0000-4000-8000-000000000002';
  let accountId: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    await db.query(
      'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
      [alice, 'Alice', 'alice@example.test', bob, 'Bob', 'bob@example.test']
    );
    await db.exec('SET ROLE omni_app');
    accountId = (
      await withIdentity(db, alice, (sql) => resolveAccount(sql, alice))
    ).accountId;
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  it('reveals plaintext once, scopes management, and rejects expired/revoked hashes', async () => {
    const minted = await withIdentity(db, alice, (sql) =>
      mintKey(sql, alice, { name: 'Integration', scopes: ['contacts:read'] })
    );
    expect(minted.plaintext).toMatch(/^wacrm_live_/);
    expect(minted.key).not.toHaveProperty('key_hash');
    expect(
      await withIdentity(db, bob, (sql) => listKeys(sql, accountId))
    ).toEqual([]);
    expect(
      await withIdentity(db, bob, (sql) =>
        revokeKey(sql, accountId, minted.key.id)
      )
    ).toBe(false);
    await db.exec('RESET ROLE; SET ROLE omni_worker');
    expect((await findKey(db, hashApiKey(minted.plaintext)))?.account_id).toBe(
      accountId
    );
    expect(await findKey(db, 'unknown')).toBeNull();
    await db.exec('RESET ROLE; SET ROLE omni_app');
    expect(
      await withIdentity(db, alice, (sql) =>
        revokeKey(sql, accountId, minted.key.id)
      )
    ).toBe(true);
    const expired = await withIdentity(db, alice, (sql) =>
      mintKey(sql, alice, {
        name: 'Expired',
        scopes: [],
        expiresAt: new Date(0),
      })
    );
    await db.exec('RESET ROLE; SET ROLE omni_worker');
    expect(await findKey(db, hashApiKey(minted.plaintext))).toBeNull();
    expect(await findKey(db, hashApiKey(expired.plaintext))).toBeNull();
  });
});
