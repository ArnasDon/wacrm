import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../../scripts/lib/migrate.mjs';
import { selectMigrationOwner } from '../../../scripts/lib/migration-role.mjs';

describe('standalone PostgreSQL migration runner', () => {
  it('refuses schema migration through a runtime role and switches administrators to the dedicated owner', async () => {
    const db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
    try {
      await db.exec(
        'CREATE ROLE omni_owner; CREATE ROLE omni_app; SET ROLE omni_app;'
      );
      await expect(selectMigrationOwner(db)).rejects.toThrow(/migration owner/);
      await db.exec('RESET ROLE');
      await selectMigrationOwner(db);
      expect((await db.query('SELECT current_user AS role')).rows).toEqual([
        { role: 'omni_owner' },
      ]);
    } finally {
      await db.close();
    }
  });
  it('applies each migration once and rejects changes to an applied file', async () => {
    const db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
    try {
      const files = [
        {
          name: '001_test.sql',
          sql: 'CREATE TABLE records (id integer PRIMARY KEY);',
        },
      ];
      expect(await migrate(db, files, { advisoryLock: false })).toEqual([
        '001_test.sql',
      ]);
      expect(await migrate(db, files, { advisoryLock: false })).toEqual([]);
      await expect(
        migrate(db, [{ ...files[0], sql: 'SELECT 1;' }], {
          advisoryLock: false,
        })
      ).rejects.toThrow(/checksum/i);
      expect(
        (await db.query('SELECT count(*)::int AS n FROM app_migrations')).rows
      ).toEqual([{ n: 1 }]);
    } finally {
      await db.close();
    }
  });

  it('rolls back DDL and history when a migration fails', async () => {
    const db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
    try {
      await expect(
        migrate(
          db,
          [
            {
              name: '001_bad.sql',
              sql: 'CREATE TABLE partial (id int); SELECT missing_function();',
            },
          ],
          { advisoryLock: false }
        )
      ).rejects.toThrow();
      expect(
        (await db.query("SELECT to_regclass('public.partial') AS relation"))
          .rows
      ).toEqual([{ relation: null }]);
      expect(
        (await db.query('SELECT count(*)::int AS n FROM app_migrations')).rows
      ).toEqual([{ n: 0 }]);
    } finally {
      await db.close();
    }
  });

  it('refuses an unmanaged domain schema without deleting user tables', async () => {
    const db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
    try {
      await db.exec(
        'CREATE TABLE profiles (id int); INSERT INTO profiles VALUES (7);'
      );
      await expect(
        migrate(db, [{ name: '001.sql', sql: 'SELECT 1;' }], {
          advisoryLock: false,
          preflight: true,
        })
      ).rejects.toThrow(/existing.*profiles/i);
      expect((await db.query('SELECT id FROM profiles')).rows).toEqual([
        { id: 7 },
      ]);
    } finally {
      await db.close();
    }
  });
  it('also rejects partial schemas containing only less common domain tables', async () => {
    const db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
    try {
      await db.exec(
        'CREATE TABLE pipelines(id int); INSERT INTO pipelines VALUES (9);'
      );
      await expect(
        migrate(db, [{ name: '001.sql', sql: 'SELECT 1;' }], {
          advisoryLock: false,
          preflight: true,
        })
      ).rejects.toThrow(/existing.*pipelines/i);
      expect((await db.query('SELECT id FROM pipelines')).rows).toEqual([
        { id: 9 },
      ]);
    } finally {
      await db.close();
    }
  });
});
