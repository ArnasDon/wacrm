import type { StorageBucket } from '@/lib/storage/filesystem';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';
export interface StoredObject {
  id: string;
  account_id: string;
  user_id: string;
  bucket: StorageBucket;
  filename: string;
  mime: string;
  bytes: number;
  is_public: boolean;
}
export async function registerStoredObject(
  db: SqlConnection,
  userId: string,
  input: Omit<StoredObject, 'account_id' | 'user_id'>
) {
  const ctx = await resolveAccount(db, userId);
  const [object] = await queryRows<StoredObject>(
    db,
    `INSERT INTO public.stored_objects(id,account_id,user_id,bucket,filename,mime,bytes,is_public)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      input.id,
      ctx.accountId,
      userId,
      input.bucket,
      input.filename,
      input.mime,
      input.bytes,
      input.is_public,
    ]
  );
  return object;
}
export async function getStoredObject(
  db: SqlConnection,
  accountId: string,
  bucket: StorageBucket,
  id: string
) {
  const [object] = await queryRows<StoredObject>(
    db,
    'SELECT * FROM public.stored_objects WHERE account_id=$1 AND bucket=$2 AND id=$3',
    [accountId, bucket, id]
  );
  return object ?? null;
}
export async function deleteStoredObject(
  db: SqlConnection,
  accountId: string,
  bucket: StorageBucket,
  id: string
) {
  const [object] = await queryRows<StoredObject>(
    db,
    'DELETE FROM public.stored_objects WHERE account_id=$1 AND bucket=$2 AND id=$3 RETURNING *',
    [accountId, bucket, id]
  );
  return object ?? null;
}
