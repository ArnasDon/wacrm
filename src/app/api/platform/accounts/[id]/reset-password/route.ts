import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import { toErrorResponse } from '@/lib/auth/account';
import { logPlatformAdminAction } from '@/lib/platform/audit-log';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { resolveBaseUrl } from '@/lib/http/base-url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

const MIN_PASSWORD_LEN = 6;

/**
 * POST /api/platform/accounts/[id]/reset-password
 *
 * Platform-admin only.
 *
 *   body.mode === 'link' (the default, primary action — same
 *   mechanism /forgot-password already uses): emails the account's
 *   OWN address a standard Supabase recovery link. The admin never
 *   sees or handles a password at all — this is the "any serious
 *   support panel does this" path the request asked for.
 *
 *   body.mode === 'direct' (secondary, for when email isn't
 *   practical): sets the password immediately via the admin API.
 *   The password value is read from the request body, forwarded
 *   straight into `auth.admin.updateUserById`, and never written
 *   anywhere else — not into `metadata` on the audit log row, not
 *   into a server log. Only the fact that a direct reset happened is
 *   recorded.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const admin = supabaseAdmin();

    const limit = checkRateLimit(`platform:resetPassword:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: account, error: accountError } = await admin
      .from('accounts')
      .select('id, owner_user_id')
      .eq('id', id)
      .maybeSingle();

    if (accountError) {
      console.error('[platform/accounts/:id/reset-password] error loading account:', accountError);
      return NextResponse.json({ error: 'Failed to load account' }, { status: 500 });
    }
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === 'direct' ? 'direct' : 'link';

    if (mode === 'direct') {
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
      if (newPassword.length < MIN_PASSWORD_LEN) {
        return NextResponse.json(
          { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
          { status: 400 },
        );
      }

      const { error } = await admin.auth.admin.updateUserById(account.owner_user_id, {
        password: newPassword,
      });
      if (error) {
        console.error('[platform/accounts/:id/reset-password] updateUserById failed:', error.message);
        return NextResponse.json({ error: 'Failed to set the new password' }, { status: 500 });
      }

      await logPlatformAdminAction(admin, {
        adminUserId: userId,
        action: 'account.password_set_directly',
        targetType: 'account',
        targetId: account.id,
        // Deliberately no password value anywhere in this call.
        metadata: {},
      });

      return NextResponse.json({ mode: 'direct', done: true });
    }

    const { data: authUser } = await admin.auth.admin.getUserById(account.owner_user_id);
    const email = authUser?.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'Could not resolve this account\'s email.' }, { status: 404 });
    }

    const baseUrl = resolveBaseUrl(request);
    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${baseUrl}/auth/callback?next=/reset-password`,
    });
    if (error) {
      console.error('[platform/accounts/:id/reset-password] resetPasswordForEmail failed:', error.message);
      return NextResponse.json({ error: 'Failed to send the reset link' }, { status: 500 });
    }

    await logPlatformAdminAction(admin, {
      adminUserId: userId,
      action: 'account.password_reset_link_sent',
      targetType: 'account',
      targetId: account.id,
      metadata: { email },
    });

    return NextResponse.json({ mode: 'link', done: true, email });
  } catch (err) {
    return toErrorResponse(err);
  }
}
