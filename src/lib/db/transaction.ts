/** The small common connection contract also supports real embedded PostgreSQL tests. */
export interface SqlConnection {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

interface ReleasableConnection extends SqlConnection {
  release(destroy?: boolean): void;
}
export async function withConnection<T, C extends ReleasableConnection>(
  pool: { connect(): Promise<C> },
  work: (connection: C) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let failed = false;
  try {
    return await work(client);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // Discard failed leases, including connections whose rollback itself failed.
    client.release(failed);
  }
}

export function pooledTransaction<T, C extends ReleasableConnection>(
  pool: { connect(): Promise<C> },
  work: (connection: C) => Promise<T>
): Promise<T> {
  return withConnection(pool, (client) => transaction(client, work));
}

export async function transaction<T, C extends SqlConnection>(
  db: C,
  work: (connection: C) => Promise<T>
): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
