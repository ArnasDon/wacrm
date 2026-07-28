import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

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

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}

const MAX_NAME_LEN = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/organization/sellers
 *
 * Owner-only, and only for an account that already owns an
 * organization (create one via POST /api/organization first). Creates
 * a BRAND NEW, fully independent account for the seller — not a
 * membership on the caller's own account, unlike
 * /api/account/invitations. The new account is exactly as isolated as
 * any other standalone wacrm account (its own whatsapp_config, its own
 * contacts/conversations/etc, its own RLS scope) except for the one
 * added grant from migration 041: the organization's owner can read
 * (never write) its data.
 *
 * Flow:
 *   1. supabase.auth.admin.inviteUserByEmail() creates the auth.users
 *      row and sends Supabase's own invite email with a link to
 *      /auth/callback → /reset-password, where the seller sets their
 *      own initial password — same "invite email, initial password"
 *      shape as the existing member-invite flow, just landing on a
 *      brand new account instead of a membership row.
 *   2. That insert synchronously fires handle_new_user() (migration
 *      017), which creates a personal account + an 'owner' profile for
 *      the new user — no manual account/profile creation needed here.
 *   3. We look up that freshly-created account and re-point its name
 *      + organization_id at the caller's organization.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner');

    const limit = checkRateLimit(`org:createSeller:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_account_id', accountId)
      .maybeSingle();
    if (orgError) {
      console.error('[organization/sellers] error loading organization:', orgError);
      return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json(
        { error: 'Create your organization first (Settings → Organization).' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!name) {
      return NextResponse.json({ error: 'Seller name is required.' }, { status: 400 });
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LEN} characters or fewer.` },
        { status: 400 },
      );
    }
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
    }

    const baseUrl = getBaseUrl(request);
    const { data: invited, error: inviteError } = await supabaseAdmin().auth.admin.inviteUserByEmail(
      email,
      {
        data: { full_name: name },
        redirectTo: `${baseUrl}/auth/callback?next=/reset-password`,
      },
    );

    if (inviteError || !invited?.user) {
      const message = inviteError?.message ?? 'Failed to invite the seller';
      console.error('[organization/sellers] inviteUserByEmail failed:', message);
      // Supabase returns a 422-ish "already registered" error for an
      // existing email — surface that distinctly so the owner
      // understands why (this route can't add an existing user to a
      // second account; one auth.users row = one account, same
      // invariant as accounts.owner_user_id's unique index).
      const alreadyExists = /already registered|already exists/i.test(message);
      return NextResponse.json(
        { error: alreadyExists ? 'This email is already registered on this deployment.' : message },
        { status: alreadyExists ? 409 : 502 },
      );
    }

    // handle_new_user() (migration 017) already ran synchronously as
    // part of the auth.users insert above, creating a personal account
    // + 'owner' profile for this new user. Find it.
    const { data: profile, error: profileError } = await supabaseAdmin()
      .from('profiles')
      .select('account_id')
      .eq('user_id', invited.user.id)
      .maybeSingle();

    if (profileError || !profile?.account_id) {
      console.error('[organization/sellers] could not resolve the new seller\'s account:', profileError);
      return NextResponse.json(
        { error: 'Seller invited, but linking their account failed. Contact support.' },
        { status: 500 },
      );
    }

    const { data: sellerAccount, error: updateError } = await supabaseAdmin()
      .from('accounts')
      .update({ name, organization_id: org.id })
      .eq('id', profile.account_id)
      .select('id, name')
      .single();

    if (updateError || !sellerAccount) {
      console.error('[organization/sellers] error linking seller account:', updateError);
      return NextResponse.json(
        { error: 'Seller invited, but linking their account failed. Contact support.' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { account: { id: sellerAccount.id, name: sellerAccount.name, isOwnerAccount: false } },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
