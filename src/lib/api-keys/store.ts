// ============================================================
// API key store — the *auth-path* data access for public API keys.
//
// Only the read side lives here, and deliberately so: it runs with
// the service-role client because a public-API caller has no Supabase
// session, so RLS (which keys off `auth.uid()`) can't scope the
// lookup. The management side (list / create / revoke) runs in the
// dashboard under a real cookie session and goes through the RLS
// client *inline* in the route handlers — same pattern as
// `/api/account/invitations`. Keeping the RLS-bypassing surface tiny
// and read-only here makes it easy to audit.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { ApiError } from '@/lib/api/v1/respond';

/** Shape of an `api_keys` row as the auth path consumes it. */
export interface ApiKeyRow {
  id: string;
  account_id: string;
  created_by: string | null;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
}

/**
 * Look up an *active* key by its SHA-256 hash. Returns null if no
 * row matches, or if the matching row is revoked or expired — so
 * callers never have to re-check liveness. Uses the service-role
 * client (RLS-bypassing); the hash is the only credential, so this
 * is the moment that establishes the caller's account.
 */
export async function findActiveKeyByHash(
  hash: string
): Promise<ApiKeyRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .select('id, account_id, created_by, name, scopes, expires_at, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle();

  if (error) {
    console.error('[api-keys/store] lookup error:', error.message);
    throw new ApiError(
      'unavailable',
      'API key verification is temporarily unavailable; retry shortly',
      503
    );
  }
  if (!data) return null;

  // Liveness checks in JS rather than SQL so the failure modes are
  // explicit and the index stays a simple equality lookup.
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return data as ApiKeyRow;
}

/**
 * Fetch the account name for a resolved key, so `/api/v1/me` and any
 * future endpoint can echo it without a second round trip in the
 * route. Service-role; the key already proved account membership.
 */
export async function getAccountName(
  accountId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.name as string) ?? null;
}

/**
 * Best-effort `last_used_at` bump. Fire-and-forget from the auth
 * path — a failed update just means the "last used" column lags;
 * it must never fail the request the caller is actually making.
 */
export function touchLastUsed(id: string): void {
  void supabaseAdmin()
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', id)
    .then(({ error }) => {
      if (error) {
        console.warn(
          '[api-keys/store] last_used_at bump failed:',
          error.message
        );
      }
    });
}
