import nextEnv from '@next/env';
import pg from 'pg';
nextEnv.loadEnvConfig(process.cwd());
for (const variable of [
  'MIGRATION_DATABASE_URL',
  'DATABASE_URL',
  'AUTH_DATABASE_URL',
  'WORKER_DATABASE_URL',
]) {
  if (!process.env[variable]) {
    console.error(`${variable}: not configured`);
    process.exitCode = 1;
    continue;
  }
  const client = new pg.Client({
    connectionString: process.env[variable],
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const {
      rows: [row],
    } = await client.query(
      'SELECT current_database() AS database, current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    );
    console.log(`${variable}: connected to ${row.database} as ${row.role}`);
    if (variable === 'DATABASE_URL' && (row.rolsuper || row.rolbypassrls))
      throw new Error(
        'Runtime role must not be a superuser or bypass row security.'
      );
  } catch (error) {
    console.error(
      `${variable}: ${error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[connection hidden]')}`
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
