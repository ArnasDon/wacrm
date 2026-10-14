// Test-only embedded PostgreSQL fixture. Never reads developer DB credentials.
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { migrate } from '../../../scripts/lib/migrate.mjs';

export async function createTestDatabase() {
  const db = new PGlite({ initialMemory: 128 * 1024 * 1024 });
  try {
    await db.exec(
      'CREATE ROLE omni_owner; CREATE ROLE omni_app; CREATE ROLE omni_auth; CREATE ROLE omni_worker BYPASSRLS; GRANT USAGE, CREATE ON SCHEMA public TO omni_owner; GRANT CREATE ON DATABASE postgres TO omni_owner; SET ROLE omni_owner;'
    );
    const names = (await readdir('database/migrations')).filter((name) =>
      name.endsWith('.sql')
    );
    const files = await Promise.all(
      names.map(async (name) => ({
        name,
        sql: await readFile(`database/migrations/${name}`, 'utf8'),
      }))
    );
    await migrate(db, files, { advisoryLock: false, preflight: true });
    await db.exec('RESET ROLE');
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
