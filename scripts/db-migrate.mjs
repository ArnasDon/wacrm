import nextEnv from '@next/env';
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { migrate } from './lib/migrate.mjs';
import { selectMigrationOwner } from './lib/migration-role.mjs';

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error(
    'Set MIGRATION_DATABASE_URL privately in .env.local. See database/README.md.'
  );
  process.exit(1);
}
const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  await selectMigrationOwner(client);
  const names = (await readdir('database/migrations')).filter((n) =>
    n.endsWith('.sql')
  );
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(`database/migrations/${name}`, 'utf8'),
    }))
  );
  const applied = await migrate(client, files, { preflight: true });
  console.log(
    applied.length
      ? `Applied: ${applied.join(', ')}`
      : 'Database is up to date.'
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
