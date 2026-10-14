import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { resolveAccount, withIdentity } from './context-core';

describe('local account context', () => {
  let db: PGlite;
  const alice = '10000000-0000-4000-8000-000000000001';
  const bob = '10000000-0000-4000-8000-000000000002';
  beforeAll(async () => {
    db = await createTestDatabase();
    await db.query(
      'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
      [alice, 'Alice', 'alice@example.test', bob, 'Bob', 'bob@example.test']
    );
    await db.exec('SET ROLE omni_app');
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  it('resolves only the authenticated membership and rejects missing identities', async () => {
    const a = await withIdentity(db, alice, (sql) =>
      resolveAccount(sql, alice)
    );
    const b = await withIdentity(db, bob, (sql) => resolveAccount(sql, bob));
    expect(a.userId).toBe(alice);
    expect(a.role).toBe('owner');
    expect(a.accountId).not.toBe(b.accountId);
    await expect(
      withIdentity(db, alice, (sql) => resolveAccount(sql, bob))
    ).rejects.toThrow(/membership/);
    await expect(
      withIdentity(db, 'invalid-id', () => Promise.resolve())
    ).rejects.toThrow(/identity/);
    expect(
      (await db.query('SELECT user_id FROM public.profiles')).rows
    ).toEqual([]);
  });

  it('rolls back writes and clears identity after a request failure', async () => {
    const a = await withIdentity(db, alice, (sql) =>
      resolveAccount(sql, alice)
    );
    await expect(
      withIdentity(db, alice, async (sql) => {
        await sql.query(
          "UPDATE public.accounts SET name='Changed' WHERE id=$1",
          [a.accountId]
        );
        throw new Error('request failed');
      })
    ).rejects.toThrow('request failed');
    const again = await withIdentity(db, alice, (sql) =>
      resolveAccount(sql, alice)
    );
    expect(again.account.name).toBe(a.account.name);
    expect(
      (await db.query('SELECT user_id FROM public.profiles')).rows
    ).toEqual([]);
  });
});
