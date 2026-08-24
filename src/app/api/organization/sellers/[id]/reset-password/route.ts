import { NextResponse } from 'next/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
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

interface TargetAccount {
  id: string;
  organization_id: string | null;
  owner_user_id: string;
}

/** Same "is this actually my seller?" check as the sibling routes
 *  under /api/organization/sellers/[id], plus owner_user_id. */
async function loadOwnedSeller(
  supabase: SupabaseClient,
  callerAccountId: string,
  targetId: string,
): Promise<{ error: NextResponse } | { target: TargetAccount }> {
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id')
    .eq('owner_account_id', callerAccountId)
    .maybeSingle();

  if (orgError) {
    console.error('[organization/sellers/:id/reset-password] error loading organization:', orgError);
    return { error: NextResponse.json({ error: 'Failed to load organization' }, { status: 500 }) };
  }
  if (!org) {
    return { error: NextResponse.json({ error: "You don't own an organization." }, { status: 400 }) };
  }
  if (targetId === callerAccountId) {
    return {
      error: NextResponse.json({ error: "Use your own account's password settings for that." }, { status: 400 }),
    };
  }

  const { data: target, error: targetError } = await supabaseAdmin()
    .from('accounts')
    .select('id, organization_id, owner_user_id')
    .eq('id', targetId)
    .maybeSingle();

  if (targetError) {
    console.error('[organization/sellers/:id/reset-password] error loading target account:', targetError);
    return { error: NextResponse.json({ error: 'Failed to load the seller account' }, { status: 500 }) };
  }
  if (!target || target.organization_id !== org.id) {
    return { error: NextResponse.json({ error: 'Seller account not found.' }, { status: 404 }) };
  }

  return { target: target as TargetAccount };
}

/**
 * POST /api/organization/sellers/[id]/reset-password
 *
 * Owner-only. Lets the store owner get a stuck seller back into their
 * account when "resend invite" no longer applies — e.g. a seller who
 * clicked the invite link once (which Supabase already counts as a
 * sign-in, marking them "Ativo") but never actually finished setting
 * a password on the /reset-password page, and is now locked out with
 * no way to self-serve a new invite email.
 *
 * Same two modes as the platform-admin equivalent
 * (platform/accounts/[id]/reset-password), scoped down to "a seller
 * this owner's organization actually owns" instead of any account on
 * the deployment:
 *
 *   mode 'link' (default): emails the seller Supabase's standard
 *   password-recovery link.
 *   mode 'direct': the owner sets the password immediately — read
 *   from the request body, forwarded straight to
 *   `auth.admin.updateUserById`, never logged or stored anywhere else.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner');

    const limit = checkRateLimit(`org:resetSellerPassword:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const result = await loadOwnedSeller(supabase, accountId, id);
    if ('error' in result) return result.error;

    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === 'direct' ? 'direct' : 'link';
    const admin = supabaseAdmin();

    if (mode === 'direct') {
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
      if (newPassword.length < MIN_PASSWORD_LEN) {
        return NextResponse.json(
          { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
          { status: 400 },
        );
      }

      const { error } = await admin.auth.admin.updateUserById(result.target.owner_user_id, {
        password: newPassword,
      });
      if (error) {
        console.error('[organization/sellers/:id/reset-password] updateUserById failed:', error.message);
        return NextResponse.json({ error: 'Failed to set the new password' }, { status: 500 });
      }

      return NextResponse.json({ mode: 'direct', done: true });
    }

    const { data: authUser } = await admin.auth.admin.getUserById(result.target.owner_user_id);
    const email = authUser?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Could not resolve this seller's email." }, { status: 404 });
    }

    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${resolveBaseUrl(request)}/auth/callback?next=/reset-password`,
    });
    if (error) {
      console.error('[organization/sellers/:id/reset-password] resetPasswordForEmail failed:', error.message);
      return NextResponse.json({ error: 'Failed to send the reset link' }, { status: 500 });
    }

    return NextResponse.json({ mode: 'link', done: true, email });
  } catch (err) {
    return toErrorResponse(err);
  }
}
