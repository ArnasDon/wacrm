import type { Tag } from '@/types';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';

export function listTags(db: SqlConnection, accountId: string) {
  return queryRows<Tag>(
    db,
    'SELECT * FROM public.tags WHERE account_id=$1 ORDER BY name,id',
    [accountId]
  );
}
export async function createTag(
  db: SqlConnection,
  userId: string,
  name: string,
  color: string
) {
  const context = await resolveAccount(db, userId);
  const [tag] = await queryRows<Tag & { account_id: string }>(
    db,
    'INSERT INTO public.tags(user_id,account_id,name,color) VALUES ($1,$2,$3,$4) RETURNING *',
    [userId, context.accountId, name, color]
  );
  return tag;
}
export async function deleteTag(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.tags WHERE account_id=$1 AND id=$2 RETURNING id',
        [accountId, id]
      )
    ).length > 0
  );
}
