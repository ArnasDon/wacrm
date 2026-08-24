import { NextResponse } from 'next/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
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

const MAX_NAME_LEN = 120;
const PHONE_DIGITS_RE = /^\d{10,15}$/;

interface TargetAccount {
  id: string;
  name: string;
  organization_id: string | null;
}

/**
 * Loads the caller's organization and validates that `targetId` is one
 * of its linked seller accounts. Shared by PATCH and DELETE below —
 * both need the exact same "is this actually my seller?" check before
 * touching another account's row via the service-role client.
 *
 * Deliberately uses the admin client to read the target account: the
 * caller's own RLS-scoped client can already see it (accounts_org_select,
 * migration 041), but reading it here through the same client we'll
 * write through keeps the check and the mutation atomic in intent —
 * and avoids a second unnecessary round trip through the RLS-scoped
 * client for a row we're about to admin-update anyway.
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
    console.error('[organization/sellers/:id] error loading organization:', orgError);
    return { error: NextResponse.json({ error: 'Failed to load organization' }, { status: 500 }) };
  }
  if (!org) {
    return { error: NextResponse.json({ error: "You don't own an organization." }, { status: 400 }) };
  }

  if (targetId === callerAccountId) {
    return {
      error: NextResponse.json(
        { error: "You can't edit or remove your own store account this way." },
        { status: 400 },
      ),
    };
  }

  const { data: target, error: targetError } = await supabaseAdmin()
    .from('accounts')
    .select('id, name, organization_id')
    .eq('id', targetId)
    .maybeSingle();

  if (targetError) {
    console.error('[organization/sellers/:id] error loading target account:', targetError);
    return { error: NextResponse.json({ error: 'Failed to load the seller account' }, { status: 500 }) };
  }
  if (!target || target.organization_id !== org.id) {
    // Same response whether the account doesn't exist or belongs to a
    // different organization — don't leak which case it is.
    return { error: NextResponse.json({ error: 'Seller account not found.' }, { status: 404 }) };
  }

  return { target: target as TargetAccount };
}

/**
 * PATCH /api/organization/sellers/[id]
 *
 * Owner-only. Renames a linked seller account, and/or edits their
 * lead-distribution settings on the owner's behalf (useful before the
 * seller has ever logged in to set their own WhatsApp number — see
 * PATCH /api/account/lead-settings for the seller's own self-service
 * version of the same two fields). The seller keeps their own login
 * and data untouched otherwise.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner');

    const limit = checkRateLimit(`org:editSeller:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const result = await loadOwnedSeller(supabase, accountId, id);
    if ('error' in result) return result.error;

    const body = await request.json().catch(() => ({}));
    const update: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return NextResponse.json({ error: 'Seller name is required.' }, { status: 400 });
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Name must be ${MAX_NAME_LEN} characters or fewer.` },
          { status: 400 },
        );
      }
      update.name = name;
    }

    if ('leadRedirectPhone' in body) {
      const raw = body.leadRedirectPhone;
      if (raw === null || raw === '') {
        update.lead_redirect_phone = null;
      } else if (typeof raw === 'string') {
        const digits = raw.replace(/\D/g, '');
        if (!PHONE_DIGITS_RE.test(digits)) {
          return NextResponse.json(
            { error: 'WhatsApp number must have 10 to 15 digits (country + area + number).' },
            { status: 400 },
          );
        }
        update.lead_redirect_phone = digits;
      }
    }

    if (typeof body?.leadRotationEnabled === 'boolean') {
      update.lead_rotation_enabled = body.leadRotationEnabled;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabaseAdmin()
      .from('accounts')
      .update(update)
      .eq('id', result.target.id)
      .select('id, name, lead_redirect_phone, lead_rotation_enabled, last_lead_assigned_at')
      .single();

    if (updateError || !updated) {
      console.error('[organization/sellers/:id] update failed:', updateError);
      return NextResponse.json({ error: 'Failed to update the seller.' }, { status: 500 });
    }

    return NextResponse.json({
      account: {
        id: updated.id,
        name: updated.name,
        leadRedirectPhone: updated.lead_redirect_phone,
        leadRotationEnabled: updated.lead_rotation_enabled,
        lastLeadAssignedAt: updated.last_lead_assigned_at,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/organization/sellers/[id]
 *
 * Owner-only. Removes the organization link (`organization_id = NULL`)
 * — this is an UNLINK, not an account deletion. The seller's account,
 * login, and all of their own data (contacts, conversations, messages)
 * stay completely intact and keep working exactly as before; they just
 * stop appearing in the store owner's consolidated view, and the
 * cross-account read grant (is_organization_owner(), migration 041)
 * stops applying to them. This mirrors "remove access", not "delete
 * their account" — deliberately the same non-destructive shape as
 * remove_account_member() for team members, which also only unlinks
 * rather than deleting the person's login.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner');

    const limit = checkRateLimit(`org:removeSeller:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const result = await loadOwnedSeller(supabase, accountId, id);
    if ('error' in result) return result.error;

    const { error: updateError } = await supabaseAdmin()
      .from('accounts')
      .update({ organization_id: null })
      .eq('id', result.target.id);

    if (updateError) {
      console.error('[organization/sellers/:id] unlink failed:', updateError);
      return NextResponse.json({ error: 'Failed to remove the seller.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
