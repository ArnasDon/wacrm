import 'server-only';
import { getPool } from '@/lib/db/pool';
import { findKey } from '@/lib/db/api-keys';
import { queryRows } from '@/lib/db/rows';

export interface ApiKeyRow {
  id: string;
  account_id: string;
  created_by: string | null;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
}
export async function findActiveKeyByHash(hash: string): Promise<ApiKeyRow | null> {
  try { return await findKey(getPool('worker'), hash); }
  catch { console.error('[api-keys] Lookup failed.'); return null; }
}
export async function getAccountName(accountId: string): Promise<string | null> {
  const [row] = await queryRows<{ name: string }>(getPool('worker'), 'SELECT name FROM public.accounts WHERE id=$1', [accountId]);
  return row?.name ?? null;
}
export function touchLastUsed(id: string): void {
  void getPool('worker').query('UPDATE public.api_keys SET last_used_at=now() WHERE id=$1', [id]).catch(() => console.warn('[api-keys] Last-used update failed.'));
}
