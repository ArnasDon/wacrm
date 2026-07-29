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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loadAccount(admin: ReturnType<typeof supabaseAdmin>, id: string) {
  const { data, error } = await admin
    .from('accounts')
    .select('id, name, owner_user_id, organization_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; name: string; owner_user_id: string; organization_id: string | null } | null;
}

/** True iff `accountId` is the STORE's own account for its organization
 *  (as opposed to a linked seller account). */
async function isStoreOwnerAccount(
  admin: ReturnType<typeof supabaseAdmin>,
  account: { id: string; organization_id: string | null },
): Promise<boolean> {
  if (!account.organization_id) return false;
  const { data: org } = await admin
    .from('organizations')
    .select('owner_account_id')
    .eq('id', account.organization_id)
    .maybeSingle();
  return org?.owner_account_id === account.id;
}

/**
 * PATCH /api/platform/accounts/[id]
 *
 * Platform-admin only. Edits an owner or seller account's name,
 * email (their login), and/or contact phone.
 *
 * "name" is ambiguous across the two account kinds and handled
 * accordingly: for a SELLER account, accounts.name IS their display
 * name everywhere else in the app (organization-settings.tsx,
 * organization-account-select.tsx), so it's updated alongside
 * profiles.full_name. For the STORE's own account, accounts.name is
 * the *business* name — a different concept, edited instead via
 * PATCH /api/platform/organizations/[id] — so only profiles.full_name
 * (the owner's personal name) changes here.
 *
 * Changing email changes the actual login (Supabase Auth), via the
 * admin API — Supabase itself rejects a duplicate/malformed email,
 * same as it already does for signUp() elsewhere in this app.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const admin = supabaseAdmin();

    const account = await loadAccount(admin, id);
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : undefined;

    if (name !== undefined) {
      if (!name) {
        return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Name must be ${MAX_NAME_LEN} characters or fewer.` },
          { status: 400 },
        );
      }
    }
    if (email !== undefined && !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
    }

    const changedFields: string[] = [];

    if (email !== undefined) {
      const { error: authError } = await admin.auth.admin.updateUserById(account.owner_user_id, {
        email,
      });
      if (authError) {
        const message = authError.message ?? 'Failed to update email';
        const alreadyExists = /already registered|already exists|already been registered/i.test(message);
        return NextResponse.json(
          { error: alreadyExists ? 'This email is already registered on this deployment.' : message },
          { status: alreadyExists ? 409 : 400 },
        );
      }
      const { error: profileEmailError } = await admin
        .from('profiles')
        .update({ email })
        .eq('user_id', account.owner_user_id);
      if (profileEmailError) {
        console.error('[platform/accounts/:id] error syncing profile email:', profileEmailError);
      }
      changedFields.push('email');
    }

    if (name !== undefined) {
      const { error: profileNameError } = await admin
        .from('profiles')
        .update({ full_name: name })
        .eq('user_id', account.owner_user_id);
      if (profileNameError) {
        console.error('[platform/accounts/:id] error updating profile name:', profileNameError);
      }
      if (!(await isStoreOwnerAccount(admin, account))) {
        const { error: accountNameError } = await admin
          .from('accounts')
          .update({ name })
          .eq('id', account.id);
        if (accountNameError) {
          console.error('[platform/accounts/:id] error updating account name:', accountNameError);
        }
      }
      changedFields.push('name');
    }

    if (phone !== undefined) {
      const { error: profilePhoneError } = await admin
        .from('profiles')
        .update({ phone: phone || null })
        .eq('user_id', account.owner_user_id);
      if (profilePhoneError) {
        console.error('[platform/accounts/:id] error updating profile phone:', profilePhoneError);
      }
      changedFields.push('phone');
    }

    if (changedFields.length > 0) {
      await logPlatformAdminAction(admin, {
        adminUserId: userId,
        action: email !== undefined ? 'account.email_update' : 'account.update',
        targetType: 'account',
        targetId: account.id,
        metadata: { changedFields, name, email, phone },
      });
    }

    return NextResponse.json({ updated: true, changedFields });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/platform/accounts/[id]
 *
 * Platform-admin only. Removes a SELLER account from its
 * organization — never the store's own account (use
 * DELETE /api/platform/organizations/[id] for that; deleting the
 * whole store is a different, more explicit action with its own
 * type-to-confirm gate).
 *
 * body.mode:
 *   'unlink' — clears organization_id only. The account and every
 *              bit of its own data stay intact; it just becomes an
 *              independent account again, exactly as if it had never
 *              joined this organization.
 *   'delete' — permanently deletes the account and everything that
 *              belongs only to it (contacts, conversations, messages,
 *              its own WhatsApp connection, ...), then removes its
 *              auth.users row.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const admin = supabaseAdmin();

    const account = await loadAccount(admin, id);
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    if (!account.organization_id) {
      return NextResponse.json(
        { error: 'This account is not linked to any organization.' },
        { status: 400 },
      );
    }
    if (await isStoreOwnerAccount(admin, account)) {
      return NextResponse.json(
        {
          error:
            'This is the store\'s own account — use DELETE /api/platform/organizations/[id] to delete the whole store.',
        },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === 'delete' ? 'delete' : body?.mode === 'unlink' ? 'unlink' : null;
    if (!mode) {
      return NextResponse.json({ error: "mode must be 'unlink' or 'delete'." }, { status: 400 });
    }

    if (mode === 'unlink') {
      const { error } = await admin
        .from('accounts')
        .update({ organization_id: null })
        .eq('id', account.id);
      if (error) {
        console.error('[platform/accounts/:id] error unlinking account:', error);
        return NextResponse.json({ error: 'Failed to unlink account' }, { status: 500 });
      }
      await logPlatformAdminAction(admin, {
        adminUserId: userId,
        action: 'account.unlink',
        targetType: 'account',
        targetId: account.id,
        metadata: { previousOrganizationId: account.organization_id },
      });
      return NextResponse.json({ unlinked: true });
    }

    // mode === 'delete'
    const { error: deleteError } = await admin.from('accounts').delete().eq('id', account.id);
    if (deleteError) {
      console.error('[platform/accounts/:id] error deleting account:', deleteError);
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
    }

    let authDeleteFailed = false;
    try {
      const { error } = await admin.auth.admin.deleteUser(account.owner_user_id);
      if (error) {
        console.error('[platform/accounts/:id] deleteUser failed:', error);
        authDeleteFailed = true;
      }
    } catch (err) {
      console.error('[platform/accounts/:id] deleteUser threw:', err);
      authDeleteFailed = true;
    }

    await logPlatformAdminAction(admin, {
      adminUserId: userId,
      action: 'account.delete',
      targetType: 'account',
      targetId: account.id,
      metadata: { previousOrganizationId: account.organization_id, authDeleteFailed },
    });

    return NextResponse.json({ deleted: true, authDeleteFailed });
  } catch (err) {
    return toErrorResponse(err);
  }
}
