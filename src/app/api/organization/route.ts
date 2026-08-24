import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// Service-role client — needed once the org has seller accounts,
// since the caller's own RLS-scoped client can only ever see the
// linked accounts through the `accounts_org_select` policy
// (migration 041), which is exactly what we want for a normal
// request, but this GET already resolves the same rows the client
// itself would see — using requireRole's own `supabase` is enough and
// deliberately kept (no service role here) so this route can never
// see MORE than the RLS policy already allows.
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

/**
 * GET /api/organization
 *
 * Owner-only. Returns the caller's organization (as the store/owner
 * account) if one exists, plus every linked account (the store itself
 * + every seller account) for the consolidated-view picker. Returns
 * `{ organization: null }` if the caller hasn't created one yet.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('owner');

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, owner_account_id, created_at, fallback_lead_phone, lead_message_template')
      .eq('owner_account_id', accountId)
      .maybeSingle();

    if (orgError) {
      console.error('[organization] error loading organization:', orgError);
      return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
    }

    if (!org) {
      return NextResponse.json({ organization: null, accounts: [] });
    }

    // RLS's accounts_org_select (migration 041) makes this return the
    // store account + every linked seller account for the caller —
    // never another organization's accounts, since is_organization_owner
    // is scoped to the caller's own owner_account_id.
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select(
        'id, name, owner_user_id, created_at, lead_redirect_phone, lead_rotation_enabled, last_lead_assigned_at',
      )
      .eq('organization_id', org.id)
      .order('name', { ascending: true });

    if (accountsError) {
      console.error('[organization] error loading linked accounts:', accountsError);
      return NextResponse.json({ error: 'Failed to load linked accounts' }, { status: 500 });
    }

    // Email + invite status live in auth.users, which no RLS policy
    // ever exposes (by design — see profiles_select in 001_initial_schema.sql,
    // scoped to auth.uid() = user_id only). The admin client is the
    // only way to read another account's owner here, same precedent as
    // the invite flow itself (organization/sellers/route.ts). Each
    // lookup is scoped to an owner_user_id this caller already proved
    // access to via the RLS-scoped `accounts` query above — this can
    // never leak a user outside the caller's own organization.
    const accountRows = (accounts ?? []) as {
      id: string;
      name: string;
      owner_user_id: string;
      created_at: string;
      lead_redirect_phone: string | null;
      lead_rotation_enabled: boolean;
      last_lead_assigned_at: string | null;
    }[];

    const enrichedAccounts = await Promise.all(
      accountRows.map(async (a) => {
        let email: string | null = null;
        let inviteStatus: 'accepted' | 'pending' = 'accepted';
        try {
          const { data: authUser } = await supabaseAdmin().auth.admin.getUserById(a.owner_user_id);
          email = authUser?.user?.email ?? null;
          // A seller who hasn't completed Supabase's invite flow (set
          // their password) has never signed in — that's the one
          // reliable "still pending" signal available from auth.users.
          inviteStatus = authUser?.user?.last_sign_in_at ? 'accepted' : 'pending';
        } catch (err) {
          console.warn('[organization] getUserById failed for', a.id, err);
        }
        return {
          id: a.id,
          name: a.name,
          isOwnerAccount: a.id === accountId,
          email,
          inviteStatus,
          joinedAt: a.created_at,
          leadRedirectPhone: a.lead_redirect_phone,
          leadRotationEnabled: a.lead_rotation_enabled,
          lastLeadAssignedAt: a.last_lead_assigned_at,
        };
      }),
    );

    return NextResponse.json({
      organization: org,
      accounts: enrichedAccounts,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 120;
const PHONE_DIGITS_RE = /^\d{10,15}$/;

/**
 * PATCH /api/organization
 *
 * Owner-only. Updates the lead-distribution fallback for the whole
 * organization: the WhatsApp number used when no seller is eligible
 * for rotation, and the wa.me pre-filled message text. See
 * 048_lead_distribution.sql.
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('owner');

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_account_id', accountId)
      .maybeSingle();
    if (orgError) {
      console.error('[organization] error loading organization for PATCH:', orgError);
      return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json({ error: "You don't own an organization." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const update: Record<string, unknown> = {};

    if ('fallbackLeadPhone' in body) {
      const raw = body.fallbackLeadPhone;
      if (raw === null || raw === '') {
        update.fallback_lead_phone = null;
      } else if (typeof raw === 'string') {
        const digits = raw.replace(/\D/g, '');
        if (!PHONE_DIGITS_RE.test(digits)) {
          return NextResponse.json(
            { error: 'Fallback phone must have 10 to 15 digits (country + area + number).' },
            { status: 400 },
          );
        }
        update.fallback_lead_phone = digits;
      }
    }

    if ('leadMessageTemplate' in body) {
      const raw = body.leadMessageTemplate;
      update.lead_message_template =
        typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 500) : null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('organizations')
      .update(update)
      .eq('id', org.id)
      .select('id, name, owner_account_id, created_at, fallback_lead_phone, lead_message_template')
      .single();

    if (updateError || !updated) {
      console.error('[organization] error updating lead-distribution settings:', updateError);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    return NextResponse.json({ organization: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/organization
 *
 * Owner-only. Creates the organization with the caller's own account
 * as owner_account_id, and immediately links that same account to it
 * (organization_id = the new org) so the store's own account shows up
 * in the consolidated picker alongside its sellers. One organization
 * per account — 409 if the caller already has one.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('owner');

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Organization name is required.' }, { status: 400 });
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LEN} characters or fewer.` },
        { status: 400 },
      );
    }

    const { data: existing } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_account_id', accountId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: 'This account already owns an organization.' },
        { status: 409 },
      );
    }

    const { data: org, error: insertError } = await supabase
      .from('organizations')
      .insert({ name, owner_account_id: accountId })
      .select('id, name, owner_account_id, created_at')
      .single();

    if (insertError || !org) {
      console.error('[organization] error creating organization:', insertError);
      return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
    }

    // Service role: the caller's own RLS-scoped client can UPDATE its
    // own account row (accounts_update, migration 017, admin+), but
    // using the admin client here removes any doubt about that policy
    // covering this specific column for an owner-only route.
    const { error: linkError } = await supabaseAdmin()
      .from('accounts')
      .update({ organization_id: org.id })
      .eq('id', accountId);

    if (linkError) {
      console.error('[organization] error linking store account:', linkError);
      return NextResponse.json({ error: 'Failed to link the store account' }, { status: 500 });
    }

    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
