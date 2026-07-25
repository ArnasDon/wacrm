// ============================================================
// DELETE /api/account/api-keys/[id] — revoke a key.
//
// Soft revoke: sets `revoked_at` rather than deleting the row, so
// the key's name/prefix stay visible in the roster as an audit
// trail ("this key existed and was turned off") and so the auth
// path's liveness check (`findActiveKeyByHash` filters revoked
// rows) starts rejecting it immediately. Admin+, enforced here and
// by the `api_keys_update` RLS policy.
//
// Revocation is effective on the next request: once `revoked_at` is
// set, `findActiveKeyByHash` returns null and the key 401s.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = await checkRateLimit(
      `admin:apiKeyRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Scope the update by account_id as well as id so an admin can
    // never revoke another account's key by guessing a UUID. (RLS
    // already enforces this; the explicit filter is belt-and-braces
    // and makes the "0 rows updated → 404" path precise.)
    const { data, error } = await ctx.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/account/api-keys/[id]] error:', error);
      return NextResponse.json(
        { error: 'Failed to revoke API key' },
        { status: 500 }
      );
    }
    if (!data) {
      // Either no such key in this account, or it was already revoked.
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
