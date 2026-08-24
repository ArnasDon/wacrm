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

interface TargetAccount {
  id: string;
  name: string;
  organization_id: string | null;
  owner_user_id: string;
}

/**
 * Same "is this actually my seller?" check as
 * PATCH/DELETE /api/organization/sellers/[id], plus owner_user_id —
 * needed here to resend Supabase's own invite email, which the other
 * two routes never had to look up.
 */
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
    console.error('[organization/sellers/:id/resend-invite] error loading organization:', orgError);
    return { error: NextResponse.json({ error: 'Failed to load organization' }, { status: 500 }) };
  }
  if (!org) {
    return { error: NextResponse.json({ error: "You don't own an organization." }, { status: 400 }) };
  }
  if (targetId === callerAccountId) {
    return {
      error: NextResponse.json({ error: "You can't invite yourself this way." }, { status: 400 }),
    };
  }

  const { data: target, error: targetError } = await supabaseAdmin()
    .from('accounts')
    .select('id, name, organization_id, owner_user_id')
    .eq('id', targetId)
    .maybeSingle();

  if (targetError) {
    console.error('[organization/sellers/:id/resend-invite] error loading target account:', targetError);
    return { error: NextResponse.json({ error: 'Failed to load the seller account' }, { status: 500 }) };
  }
  if (!target || target.organization_id !== org.id) {
    return { error: NextResponse.json({ error: 'Seller account not found.' }, { status: 404 }) };
  }

  return { target: target as TargetAccount };
}

/**
 * POST /api/organization/sellers/[id]/resend-invite
 *
 * Owner-only. Re-sends Supabase's own invite email to a seller who
 * hasn't accepted yet (never signed in) — the same
 * `auth.admin.inviteUserByEmail()` call POST /api/organization/sellers
 * makes when creating the seller, which Supabase resends with a fresh
 * link when called again for an account that's still pending.
 *
 * Refuses once the seller has ever signed in: at that point they
 * already have access, and resending an invite email would be
 * confusing — PATCH /api/platform/accounts/[id]/reset-password (or
 * the seller's own "forgot password") is the right tool for "they
 * lost their password," not this one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner');

    const limit = checkRateLimit(`org:resendInvite:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const result = await loadOwnedSeller(supabase, accountId, id);
    if ('error' in result) return result.error;

    const { data: authUser, error: authError } = await supabaseAdmin().auth.admin.getUserById(
      result.target.owner_user_id,
    );
    if (authError || !authUser?.user?.email) {
      console.error('[organization/sellers/:id/resend-invite] could not load auth user:', authError);
      return NextResponse.json({ error: 'Failed to load the seller login' }, { status: 500 });
    }
    if (authUser.user.last_sign_in_at) {
      return NextResponse.json(
        { error: 'This seller already signed in — resending an invite no longer applies. Use "Reset password" instead.' },
        { status: 409 },
      );
    }

    const { error: inviteError } = await supabaseAdmin().auth.admin.inviteUserByEmail(
      authUser.user.email,
      { redirectTo: `${resolveBaseUrl(request)}/auth/callback?next=/reset-password` },
    );

    if (inviteError) {
      console.error('[organization/sellers/:id/resend-invite] invite failed:', inviteError);
      return NextResponse.json({ error: inviteError.message || 'Failed to resend the invite' }, { status: 502 });
    }

    return NextResponse.json({ resent: true, email: authUser.user.email });
  } catch (err) {
    return toErrorResponse(err);
  }
}
