import 'server-only';
import { Pool } from 'pg';
import { pooledTransaction } from './transaction';

type DatabasePurpose = 'runtime' | 'worker' | 'auth' | 'coordination';
const pools = new Map<DatabasePurpose, Pool>();
const variables = {
  runtime: 'DATABASE_URL',
  worker: 'WORKER_DATABASE_URL',
  auth: 'AUTH_DATABASE_URL',
  coordination: 'WORKER_DATABASE_URL',
} as const;

export function getPool(purpose: DatabasePurpose = 'runtime'): Pool {
  const existing = pools.get(purpose);
  if (existing) return existing;
  const variable = variables[purpose];
  const connectionString = process.env[variable];
  if (!connectionString)
    throw new Error(
      `${variable} is not configured. Follow database/README.md for local PostgreSQL setup.`
    );
  const options =
    purpose === 'auth'
      ? '-c statement_timeout=15000 -c search_path=identity,public'
      : purpose === 'coordination'
        ? '-c statement_timeout=0'
        : '-c statement_timeout=15000';
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    options,
  });
  pool.on('error', (error) =>
    console.error('[postgres] Idle connection error:', error.message)
  );
  pools.set(purpose, pool);
  return pool;
}

export async function withTransaction<T>(
  work: (connection: import('pg').PoolClient) => Promise<T>,
  purpose: DatabasePurpose = 'runtime'
): Promise<T> {
  return pooledTransaction(getPool(purpose), work);
}
