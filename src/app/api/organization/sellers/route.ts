import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
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

const MAX_NAME_LEN = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;

/**
 * POST /api/organization/sellers
 *
 * Owner-only, and only for an account that already owns an
 * organization (create one via POST /api/organization first). Creates
 * a BRAND NEW, fully independent account for the seller — not a
 * membership on the caller's own account, unlike
 * /api/account/invitations. The new account is exactly as isolated as
 * any other standalone account (its own whatsapp_config, its own
 * contacts/conversations/etc, its own RLS scope) except for the one
 * added grant from migration 041: the organization's owner can read
 * (never write) its data.
 *
 * Two ways to onboard the seller, chosen by whether `password` is in
 * the request body:
 *
 *   - No password (default): supabase.auth.admin.inviteUserByEmail()
 *     creates the auth.users row and sends Supabase's own invite
 *     email with a link to /auth/callback → /reset-password, where
 *     the seller sets their own initial password.
 *   - Password provided: the owner sets the seller's login right now,
 *     via supabase.auth.admin.createUser({ email, password,
 *     email_confirm: true }) — no email dependency at all. The owner
 *     hands the credentials to the seller directly (WhatsApp, verbally,
 *     whatever). Added because Supabase's invite email depends on
 *     NEXT_PUBLIC_SITE_URL being correctly configured and on the
 *     recipient's mail provider actually delivering it — this gives
 *     the owner a way to get a seller in even when either of those
 *     isn't cooperating.
 *
 * Both paths return the same `{ data: { user }, error }` shape from
 * Supabase, so everything downstream (finding the freshly-created
 * profile via handle_new_user(), renaming + linking the account) is
 * identical either way.
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
    const password = typeof body?.password === 'string' ? body.password : '';

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
    if (password && password.length < MIN_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
        { status: 400 },
      );
    }

    const { data: created, error: createError } = password
      ? await supabaseAdmin().auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: name },
        })
      : await supabaseAdmin().auth.admin.inviteUserByEmail(email, {
          data: { full_name: name },
          redirectTo: `${resolveBaseUrl(request)}/auth/callback?next=/reset-password`,
        });

    if (createError || !created?.user) {
      const message = createError?.message ?? 'Failed to create the seller account';
      console.error('[organization/sellers] create/invite failed:', message);
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
      .eq('user_id', created.user.id)
      .maybeSingle();

    if (profileError || !profile?.account_id) {
      console.error('[organization/sellers] could not resolve the new seller\'s account:', profileError);
      return NextResponse.json(
        { error: 'Seller created, but linking their account failed. Contact support.' },
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
        { error: 'Seller created, but linking their account failed. Contact support.' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        account: { id: sellerAccount.id, name: sellerAccount.name, isOwnerAccount: false },
        mode: password ? 'direct' : 'email',
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
