import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { migrate } from '../../../scripts/lib/migrate.mjs';

describe('standalone CRM schema and row security', () => {
  let db: PGlite;
  const alice = '10000000-0000-4000-8000-000000000001';
  const bob = '10000000-0000-4000-8000-000000000002';
  beforeAll(async () => {
    db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
    await db.exec(
      'CREATE ROLE omni_owner; CREATE ROLE omni_app; CREATE ROLE omni_auth; CREATE ROLE omni_worker BYPASSRLS; GRANT USAGE, CREATE ON SCHEMA public TO omni_owner; GRANT CREATE ON DATABASE postgres TO omni_owner; SET ROLE omni_owner;'
    );
    const files = await Promise.all(
      [
        '001_identity.sql',
        '002_domain.sql',
        '003_function_permissions.sql',
      ].map(async (name) => ({
        name,
        sql: await readFile(`database/migrations/${name}`, 'utf8'),
      }))
    );
    await migrate(db, files, { advisoryLock: false, preflight: true });
    await db.query('RESET ROLE');
    await db.query(
      'INSERT INTO identity.users(id, name, email) VALUES ($1,$2,$3),($4,$5,$6)',
      [alice, 'Alice', 'alice@example.test', bob, 'Bob', 'bob@example.test']
    );
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  it('atomically provisions owner accounts and all required domain tables without managed services', async () => {
    expect(
      (await db.query('SELECT count(*)::int AS n FROM public.profiles')).rows
    ).toEqual([{ n: 2 }]);
    expect(
      (
        await db.query(
          'SELECT account_role FROM public.profiles ORDER BY email'
        )
      ).rows
    ).toEqual([{ account_role: 'owner' }, { account_role: 'owner' }]);
    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'contacts',
        'messages',
        'conversations',
        'flows',
        'automations',
        'ai_knowledge_chunks',
        'api_keys',
        'notifications',
        'quick_replies',
      ])
    );
  });

  it('scopes queries to the request identity and prevents self-service role escalation', async () => {
    await db.exec('BEGIN; SET LOCAL ROLE omni_app;');
    try {
      await db.query("SELECT set_config('app.user_id', $1, true)", [alice]);
      expect((await db.query('SELECT user_id FROM profiles')).rows).toEqual([
        { user_id: alice },
      ]);
      await expect(
        db.query("UPDATE profiles SET account_role='admin' WHERE user_id=$1", [
          alice,
        ])
      ).rejects.toThrow(/cannot be changed directly/);
    } finally {
      await db.query('ROLLBACK');
    }
    await db.exec('BEGIN; SET LOCAL ROLE omni_app;');
    try {
      // No identity has leaked from the previous transaction.
      expect((await db.query('SELECT user_id FROM profiles')).rows).toEqual([]);
      await db.query("SELECT set_config('app.user_id', $1, true)", [bob]);
      expect((await db.query('SELECT user_id FROM profiles')).rows).toEqual([
        { user_id: bob },
      ]);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('rejects identity-table reads by the domain runtime role', async () => {
    await db.exec('BEGIN; SET LOCAL ROLE omni_app;');
    try {
      await expect(db.query('SELECT * FROM identity.sessions')).rejects.toThrow(
        /permission denied/
      );
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('does not expose privileged worker functions to authenticated users', async () => {
    await db.exec('BEGIN; SET LOCAL ROLE omni_app;');
    try {
      await expect(
        db.query('SELECT public.record_webhook_failure($1, 3)', [alice])
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.query('ROLLBACK');
    }
    await db.exec('BEGIN; SET LOCAL ROLE omni_app;');
    try {
      await expect(
        db.query('SELECT public.claim_ai_reply_slot($1, 3)', [alice])
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
