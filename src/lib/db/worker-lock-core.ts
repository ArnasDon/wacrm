import { withConnection, type SqlConnection } from './transaction';

/** A session lock spans provider calls without opening a SQL transaction. */
export async function withWorkerLock<
  T,
  C extends SqlConnection & { release(destroy?: boolean): void },
>(
  pool: { connect(): Promise<C> },
  key: string,
  work: () => Promise<T>
): Promise<T> {
  return withConnection(pool, async (connection) => {
    await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
      key,
    ]);
    try {
      return await work();
    } finally {
      await connection.query(
        'SELECT pg_advisory_unlock(hashtextextended($1,0))',
        [key]
      );
    }
  });
}
