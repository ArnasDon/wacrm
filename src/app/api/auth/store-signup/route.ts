import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { bootstrapStoreOrganization, BootstrapOrganizationError } from '@/lib/organizations/bootstrap';

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

/**
 * POST /api/auth/store-signup
 *
 * Called right after a public `supabase.auth.signUp()` (the /signup
 * page, no invite token — see its own comment) to turn the brand new
 * personal account into a store: rename it and bootstrap its
 * organization, using the same bootstrapStoreOrganization() sequence
 * POST /api/platform/organizations uses for a platform-admin-created
 * store.
 *
 * Deliberately NOT gated by requireRole/requirePlatformAdmin — the
 * caller has no session yet at this point (email confirmation is
 * typically still pending), by construction. The security boundary
 * here is narrower but sufficient: `userId` alone can't hijack an
 * unrelated account's setup, because
 *   (a) this only ever proceeds for an account whose organization_id
 *       is NULL — an account that's already the store of its own
 *       organization, or is a seller linked into somebody else's, is
 *       never touched;
 *   (b) even the idempotent "already ran, here's the existing org"
 *       response is refused unless THIS account is that
 *       organization's own owner_account_id (never leaks a stranger's
 *       org name/status back to a caller who merely knows their
 *       user id);
 *   (c) rate-limited per userId, same as every other admin-shaped
 *       action in this codebase (no extra CAPTCHA — the prompt
 *       driving this route explicitly scoped that to a later phase).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const storeName = typeof body?.storeName === 'string' ? body.storeName.trim() : '';

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
  }
  if (!storeName) {
    return NextResponse.json({ error: 'Store name is required.' }, { status: 400 });
  }
  if (storeName.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: `Name must be ${MAX_NAME_LEN} characters or fewer.` },
      { status: 400 },
    );
  }

  const limit = checkRateLimit(`auth:storeSignup:${userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const admin = supabaseAdmin();

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError || !profile?.account_id) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('id, organization_id')
    .eq('id', profile.account_id)
    .maybeSingle();

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  if (account.organization_id) {
    const { data: existingOrg } = await admin
      .from('organizations')
      .select('id, name, status, created_at, owner_account_id')
      .eq('id', account.organization_id)
      .maybeSingle();

    // Idempotent retry (e.g. a flaky network call re-fired this
    // request) — only when THIS account is already that
    // organization's own store, never for a seller account linked
    // into someone else's org (which never leaks that org's details
    // back to a caller who merely knows this account's user id).
    if (existingOrg?.owner_account_id === account.id) {
      return NextResponse.json({
        organization: {
          id: existingOrg.id,
          name: existingOrg.name,
          status: existingOrg.status,
          createdAt: existingOrg.created_at,
        },
      });
    }
    return NextResponse.json(
      { error: 'This account is already linked to an organization.' },
      { status: 409 },
    );
  }

  try {
    const org = await bootstrapStoreOrganization(admin, account.id, storeName);
    return NextResponse.json(
      {
        organization: {
          id: org.id,
          name: org.name,
          status: org.status,
          createdAt: org.created_at,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const stage = err instanceof BootstrapOrganizationError ? err.stage : 'unknown';
    console.error(`[auth/store-signup] bootstrap failed at stage "${stage}":`, err);
    return NextResponse.json(
      { error: 'Account created, but setting up your store failed. Contact support.' },
      { status: 500 },
    );
  }
}
