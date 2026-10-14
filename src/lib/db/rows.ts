import type { SqlConnection } from './transaction';

/** Internal parameterized SQL boundary. SQL text is never accepted from HTTP. */
export async function queryRows<T>(
  db: SqlConnection,
  sql: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = (await db.query(sql, values)) as { rows: T[] };
  return result.rows;
}
