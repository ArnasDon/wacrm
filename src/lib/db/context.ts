import 'server-only';
import type { PoolClient } from 'pg';
import { requireSession } from '@/lib/auth/session';
import { getPool } from './pool';
import {
  resolveAccount,
  withIdentity,
  type LocalAccountContext,
} from './context-core';
import { withConnection } from './transaction';

export type { LocalAccountContext } from './context-core';

export async function getLocalAccountContext(): Promise<LocalAccountContext> {
  const user = await requireSession();
  return withConnection(getPool(), (client) =>
    withIdentity(client, user.id, (sql) => resolveAccount(sql, user.id))
  );
}

/** Recheck membership within each operation; never trust a browser-supplied account. */
export async function withAccount<T>(
  context: LocalAccountContext,
  work: (db: PoolClient) => Promise<T>
): Promise<T> {
  return withConnection<T, PoolClient>(getPool(), (client) =>
    withIdentity(client, context.userId, async (sql) => {
      const current = await resolveAccount(sql, context.userId);
      if (
        current.accountId !== context.accountId ||
        current.role !== context.role
      )
        throw new Error('Account membership changed. Refresh and retry.');
      return work(sql);
    })
  );
}
