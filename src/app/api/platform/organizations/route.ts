import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import { toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { bootstrapStoreOrganization, BootstrapOrganizationError } from '@/lib/organizations/bootstrap';
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

/**
 * GET /api/platform/organizations
 *
 * Platform-admin only (see requirePlatformAdmin — 403 for anyone
 * else, and the /painel-a17c94fe2b6d page itself 404s instead of
 * rendering a "no permission" screen). Lists EVERY organization on
 * the deployment, across completely unrelated stores — this is the
 * one screen in the app that deliberately ignores per-account/
 * per-organization isolation, by design (migration 042's
 * organizations_platform_select / accounts_platform_select policies).
 */
export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin();

    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name, owner_account_id, created_at, status, billing_status')
      .order('created_at', { ascending: false });

    if (orgsError) {
      console.error('[platform/organizations] error loading organizations:', orgsError);
      return NextResponse.json({ error: 'Failed to load organizations' }, { status: 500 });
    }

    const rows = await Promise.all(
      (orgs ?? []).map(async (org: {
        id: string;
        name: string;
        owner_account_id: string;
        created_at: string;
        status: string;
        billing_status: string;
      }) => {
        const { count } = await supabase
          .from('accounts')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org.id);

        const { data: ownerAccount } = await supabase
          .from('accounts')
          .select('owner_user_id')
          .eq('id', org.owner_account_id)
          .maybeSingle();

        let ownerEmail: string | null = null;
        if (ownerAccount?.owner_user_id) {
          try {
            const { data: authUser } = await supabaseAdmin().auth.admin.getUserById(
              ownerAccount.owner_user_id,
            );
            ownerEmail = authUser?.user?.email ?? null;
          } catch (err) {
            console.warn('[platform/organizations] getUserById failed for', org.id, err);
          }
        }

        const totalAccounts = count ?? 0;
        return {
          id: org.id,
          name: org.name,
          status: org.status,
          billingStatus: org.billing_status,
          createdAt: org.created_at,
          ownerEmail,
          // Excludes the store's own account, same convention as the
          // Settings → Organization overview tile's seller count.
          sellerCount: Math.max(0, totalAccounts - 1),
        };
      }),
    );

    return NextResponse.json({ organizations: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/platform/organizations
 *
 * Platform-admin only. Bootstraps a brand new store in one step:
 *   1. supabase.auth.admin.inviteUserByEmail() creates the owner's
 *      auth.users row and sends Supabase's own invite email — the
 *      exact same mechanism /api/organization/sellers uses today.
 *   2. That synchronously fires handle_new_user() (migration 017),
 *      creating a personal account + 'owner' profile.
 *   3. Rename that account to the store name, create its
 *      organization, and link the two — mirroring what
 *      POST /api/organization does for a self-service owner, just
 *      performed here on behalf of a not-yet-signed-in new owner.
 *
 * This is the manual path the platform operator uses to onboard each
 * paying store until Phase 2 automates it behind checkout.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();

    const limit = checkRateLimit(`platform:createOrg:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    const storeName = typeof body?.storeName === 'string' ? body.storeName.trim() : '';
    const ownerEmail =
      typeof body?.ownerEmail === 'string' ? body.ownerEmail.trim().toLowerCase() : '';

    if (!storeName) {
      return NextResponse.json({ error: 'Store name is required.' }, { status: 400 });
    }
    if (storeName.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LEN} characters or fewer.` },
        { status: 400 },
      );
    }
    if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) {
      return NextResponse.json({ error: 'A valid owner email is required.' }, { status: 400 });
    }

    const baseUrl = resolveBaseUrl(request);
    const { data: invited, error: inviteError } = await supabaseAdmin().auth.admin.inviteUserByEmail(
      ownerEmail,
      {
        data: { full_name: storeName },
        redirectTo: `${baseUrl}/auth/callback?next=/reset-password`,
      },
    );

    if (inviteError || !invited?.user) {
      const message = inviteError?.message ?? 'Failed to invite the store owner';
      console.error('[platform/organizations] inviteUserByEmail failed:', message);
      const alreadyExists = /already registered|already exists/i.test(message);
      return NextResponse.json(
        { error: alreadyExists ? 'This email is already registered on this deployment.' : message },
        { status: alreadyExists ? 409 : 502 },
      );
    }

    const { data: profile, error: profileError } = await supabaseAdmin()
      .from('profiles')
      .select('account_id')
      .eq('user_id', invited.user.id)
      .maybeSingle();

    if (profileError || !profile?.account_id) {
      console.error('[platform/organizations] could not resolve the new owner\'s account:', profileError);
      return NextResponse.json(
        { error: 'Owner invited, but linking their account failed. Contact support.' },
        { status: 500 },
      );
    }

    let org
    try {
      org = await bootstrapStoreOrganization(supabaseAdmin(), profile.account_id, storeName);
    } catch (err) {
      const stage = err instanceof BootstrapOrganizationError ? err.stage : 'unknown';
      console.error(`[platform/organizations] bootstrap failed at stage "${stage}":`, err);
      const messageByStage: Record<string, string> = {
        rename: 'Owner invited, but naming their account failed. Contact support.',
        create: 'Owner invited, but creating their organization failed. Contact support.',
        link: 'Organization created, but linking the store account failed. Contact support.',
      };
      return NextResponse.json(
        { error: messageByStage[stage] ?? 'Owner invited, but setting up their store failed. Contact support.' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        organization: {
          id: org.id,
          name: org.name,
          status: org.status,
          billingStatus: org.billing_status,
          createdAt: org.created_at,
          ownerEmail,
          sellerCount: 0,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
