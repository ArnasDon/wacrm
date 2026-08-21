import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import { toErrorResponse } from '@/lib/auth/account';
import { logPlatformAdminAction } from '@/lib/platform/audit-log';

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

interface AccountRow {
  id: string;
  name: string;
  owner_user_id: string;
  organization_id: string | null;
  created_at: string;
}

async function hydrateAccount(admin: ReturnType<typeof supabaseAdmin>, account: AccountRow) {
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email, phone')
    .eq('user_id', account.owner_user_id)
    .maybeSingle();

  let inviteStatus: 'accepted' | 'pending' = 'accepted';
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(account.owner_user_id);
    inviteStatus = authUser?.user?.last_sign_in_at ? 'accepted' : 'pending';
  } catch (err) {
    console.warn('[platform/organizations/:id] getUserById failed for', account.id, err);
  }

  return {
    accountId: account.id,
    userId: account.owner_user_id,
    name: profile?.full_name ?? account.name,
    email: profile?.email ?? null,
    phone: profile?.phone ?? null,
    joinedAt: account.created_at,
    inviteStatus,
  };
}

/**
 * GET /api/platform/organizations/[id]
 *
 * Platform-admin only. Full detail for one store: the organization
 * itself, its owner account, and every linked seller account —
 * everything /painel-a17c94fe2b6d/lojas/[id] renders.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const admin = supabaseAdmin();

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .select('id, name, status, billing_status, created_at, owner_account_id')
      .eq('id', id)
      .maybeSingle();

    if (orgError) {
      console.error('[platform/organizations/:id] error loading organization:', orgError);
      return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const { data: accounts, error: accountsError } = await admin
      .from('accounts')
      .select('id, name, owner_user_id, organization_id, created_at')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: true });

    if (accountsError) {
      console.error('[platform/organizations/:id] error loading accounts:', accountsError);
      return NextResponse.json({ error: 'Failed to load linked accounts' }, { status: 500 });
    }

    const rows = (accounts ?? []) as AccountRow[];
    const ownerRow = rows.find((a) => a.id === org.owner_account_id);
    const sellerRows = rows.filter((a) => a.id !== org.owner_account_id);

    const owner = ownerRow ? await hydrateAccount(admin, ownerRow) : null;
    const sellers = await Promise.all(sellerRows.map((a) => hydrateAccount(admin, a)));

    return NextResponse.json({
      organization: {
        id: org.id,
        name: org.name,
        status: org.status,
        billingStatus: org.billing_status,
        createdAt: org.created_at,
      },
      owner,
      sellers,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/platform/organizations/[id]
 *
 * Platform-admin only. Renames the store — updates BOTH
 * organizations.name and the store's own accounts.name together,
 * since they're set from the same value at creation (see
 * bootstrapStoreOrganization) and every list in this app displays
 * accounts.name as the store's identity.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const admin = supabaseAdmin();

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'Store name is required.' }, { status: 400 });
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LEN} characters or fewer.` },
        { status: 400 },
      );
    }

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .update({ name })
      .eq('id', id)
      .select('id, name, status, billing_status, created_at, owner_account_id')
      .maybeSingle();

    if (orgError) {
      console.error('[platform/organizations/:id] error renaming organization:', orgError);
      return NextResponse.json({ error: 'Failed to rename organization' }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const { error: accountError } = await admin
      .from('accounts')
      .update({ name })
      .eq('id', org.owner_account_id);

    if (accountError) {
      console.error('[platform/organizations/:id] error renaming store account:', accountError);
    }

    await logPlatformAdminAction(admin, {
      adminUserId: userId,
      action: 'organization.update',
      targetType: 'organization',
      targetId: org.id,
      metadata: { name },
    });

    return NextResponse.json({
      organization: {
        id: org.id,
        name: org.name,
        status: org.status,
        billingStatus: org.billing_status,
        createdAt: org.created_at,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/platform/organizations/[id]
 *
 * Platform-admin only. The single most destructive action in the
 * system: permanently deletes the organization, its store account,
 * every linked seller account, and everything that belongs to any of
 * those accounts (contacts, conversations, messages, WhatsApp
 * connections, ...). Requires the caller to have already typed the
 * store's exact name (`confirmName`) — re-validated here, never
 * trusted from a client-side-only gate.
 *
 * Atomicity: a single `DELETE FROM accounts WHERE organization_id =
 * …` is one SQL statement — every cascading delete it triggers
 * (contacts → conversations → messages, tags, whatsapp_config,
 * flows, ..., see migration 017/026/027/etc.'s ON DELETE CASCADE
 * chains, and organizations.owner_account_id's own CASCADE, which
 * removes the organization row itself as part of deleting the store
 * account) happens inside that ONE statement's transaction — all or
 * nothing at the database level. The follow-up per-user
 * `auth.admin.deleteUser()` calls are a separate service (GoTrue,
 * not Postgres) and can't share that transaction; by the time they
 * run, the dangerous part (business data) is already atomically
 * gone, so a stray leftover auth.users row here is inert, not a
 * half-deleted store.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const admin = supabaseAdmin();

    const body = await request.json().catch(() => ({}));
    const confirmName = typeof body?.confirmName === 'string' ? body.confirmName : '';

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .select('id, name')
      .eq('id', id)
      .maybeSingle();

    if (orgError) {
      console.error('[platform/organizations/:id] error loading organization for delete:', orgError);
      return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (confirmName !== org.name) {
      return NextResponse.json(
        { error: 'Type the store name exactly to confirm deletion.' },
        { status: 400 },
      );
    }

    const { data: deletedAccounts, error: deleteError } = await admin
      .from('accounts')
      .delete()
      .eq('organization_id', org.id)
      .select('id, owner_user_id');

    if (deleteError) {
      console.error('[platform/organizations/:id] error deleting linked accounts:', deleteError);
      return NextResponse.json({ error: 'Failed to delete the store' }, { status: 500 });
    }

    // Defensive — the store account's own cascade (organizations.
    // owner_account_id ON DELETE CASCADE) already removes this row
    // as part of the delete above in the normal case; this covers
    // the unexpected edge case of an organization row with no
    // matching accounts.
    await admin.from('organizations').delete().eq('id', org.id);

    const deletedOwnerUserIds = (deletedAccounts ?? []).map(
      (a: { id: string; owner_user_id: string }) => a.owner_user_id,
    );

    const authDeleteFailures: string[] = [];
    for (const ownerUserId of deletedOwnerUserIds) {
      try {
        const { error } = await admin.auth.admin.deleteUser(ownerUserId);
        if (error) {
          console.error('[platform/organizations/:id] deleteUser failed for', ownerUserId, error);
          authDeleteFailures.push(ownerUserId);
        }
      } catch (err) {
        console.error('[platform/organizations/:id] deleteUser threw for', ownerUserId, err);
        authDeleteFailures.push(ownerUserId);
      }
    }

    await logPlatformAdminAction(admin, {
      adminUserId: userId,
      action: 'organization.delete',
      targetType: 'organization',
      targetId: org.id,
      metadata: {
        name: org.name,
        deletedAccountCount: deletedAccounts?.length ?? 0,
        authDeleteFailures,
      },
    });

    return NextResponse.json({
      deleted: true,
      deletedAccountCount: deletedAccounts?.length ?? 0,
      authDeleteFailures,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
