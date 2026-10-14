import 'server-only';
import type { PoolClient } from 'pg';
import { findActiveKeyByHash, touchLastUsed } from '@/lib/api-keys/store';
import { hashApiKey, looksLikeApiKey } from '@/lib/api-keys/keys';
import { hasScope, type ApiScope } from '@/lib/api-keys/scopes';
import {
  badRequest,
  forbidden,
  rateLimited,
  unauthorized,
} from '@/lib/api/v1/respond';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { withTransaction } from '@/lib/db/pool';
import { authorizeApiOperation } from '@/lib/db/public-api';

export interface LocalApiKeyContext {
  authType: 'api_key';
  accountId: string;
  keyId: string;
  scopes: string[];
  createdBy: string | null;
}
export async function requireLocalApiKey(
  request: Request,
  scope?: ApiScope
): Promise<LocalApiKeyContext> {
  const header = request.headers.get('authorization') ?? '';
  const presented = (
    header.startsWith('Bearer ') ? header.slice(7) : header
  ).trim();
  if (!looksLikeApiKey(presented)) throw unauthorized();
  const row = await findActiveKeyByHash(hashApiKey(presented));
  if (!row) throw unauthorized();
  const limit = checkRateLimit(`apikey:${row.id}`, RATE_LIMITS.publicApi);
  if (!limit.success) throw rateLimited(limit);
  if (scope && !hasScope(row.scopes, scope))
    throw forbidden(`This API key is missing the '${scope}' scope`);
  touchLastUsed(row.id);
  return {
    authType: 'api_key',
    accountId: row.account_id,
    keyId: row.id,
    scopes: row.scopes,
    createdBy: row.created_by,
  };
}
/** Trusted server access: the key's account is revalidated; no human session is impersonated. */
export function withApiKeyAccount<T>(
  ctx: LocalApiKeyContext,
  scope: ApiScope,
  work: (db: PoolClient, auditUserId: string) => Promise<T>
): Promise<T> {
  return withTransaction(async (db) => {
    const current = await authorizeApiOperation(db, ctx, scope);
    return work(db, current.auditUserId);
  }, 'worker');
}
export function apiUUID(value: unknown, name = 'id'): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    throw badRequest(`Invalid ${name}.`);
  return value;
}
export async function apiBody(
  request: Request
): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw badRequest('Request body must be a JSON object');
  return body;
}
