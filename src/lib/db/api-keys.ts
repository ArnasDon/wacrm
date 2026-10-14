import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';
import { generateApiKey } from '@/lib/api-keys/keys';
import type { ApiKeyRow } from '@/lib/api-keys/store';

export interface SafeApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
const safeColumns =
  'id,name,key_prefix,scopes,last_used_at,expires_at,revoked_at,created_at';
export function listKeys(
  db: SqlConnection,
  accountId: string
): Promise<SafeApiKey[]> {
  return queryRows(
    db,
    `SELECT ${safeColumns} FROM public.api_keys WHERE account_id=$1 ORDER BY created_at DESC`,
    [accountId]
  );
}
export async function mintKey(
  db: SqlConnection,
  userId: string,
  input: { name: string; scopes: string[]; expiresAt?: Date | null }
) {
  const ctx = await resolveAccount(db, userId);
  const generated = generateApiKey();
  const [key] = await queryRows<SafeApiKey>(
    db,
    `INSERT INTO public.api_keys(account_id,created_by,name,key_prefix,key_hash,scopes,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${safeColumns}`,
    [
      ctx.accountId,
      userId,
      input.name,
      generated.prefix,
      generated.hash,
      input.scopes,
      input.expiresAt ?? null,
    ]
  );
  return { key, plaintext: generated.plaintext };
}
export async function revokeKey(
  db: SqlConnection,
  accountId: string,
  id: string
): Promise<boolean> {
  return (
    (
      await queryRows(
        db,
        'UPDATE public.api_keys SET revoked_at=now() WHERE account_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id',
        [accountId, id]
      )
    ).length > 0
  );
}
/** Trusted server auth path; call only with the background pool. */
export async function findKey(
  db: SqlConnection,
  hash: string
): Promise<ApiKeyRow | null> {
  const [row] = await queryRows<ApiKeyRow>(
    db,
    `SELECT id,account_id,created_by,name,scopes,expires_at,revoked_at FROM public.api_keys
    WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,
    [hash]
  );
  return row ?? null;
}
