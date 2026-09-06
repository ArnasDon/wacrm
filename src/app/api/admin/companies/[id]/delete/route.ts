import { NextResponse } from 'next/server';
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import { platformAdminClient } from '@/lib/platform/admin-client';

/**
 * POST /api/admin/companies/[id]/delete
 *
 * Platform-admin only. **Permanently deletes a company and everything
 * tied to it.** Irreversible.
 *
 * Body: `{ confirm_name: string }` — must match the company name exactly
 * (case-insensitive, trimmed), a typo guard against firing this by
 * accident.
 *
 * What it removes:
 *   1. Storage objects under `account-<id>/` in every account-scoped
 *      bucket (best-effort — a bucket error is logged, not fatal).
 *   2. Platform-level rows that only `SET NULL` on account delete
 *      (invitations, support tickets) — removed outright so no orphans
 *      linger in the admin panel.
 *   3. The `accounts` row — its `ON DELETE CASCADE` FKs then take out
 *      every tenant table (contacts, conversations, deals, products,
 *      flows, all `*_config`, `profiles`, …) in one statement.
 *   4. Each member's `auth.users` account (not covered by the DB
 *      cascade). Failures are collected into `warnings`, not fatal.
 *
 * Refuses to delete the account the acting admin is signed in under.
 */

const ACCOUNT_SCOPED_BUCKETS = [
  'catalog-documents',
  'catalog-media',
  'chat-media',
  'flow-media',
  'product-media',
];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      confirm_name?: unknown;
    } | null;

    const admin = platformAdminClient();

    const { data: account, error: acctErr } = await admin
      .from('accounts')
      .select('id, name, owner_user_id')
      .eq('id', id)
      .maybeSingle();
    if (acctErr) throw acctErr;
    if (!account) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    if (id === ctx.accountId) {
      return NextResponse.json(
        { error: 'No puedes eliminar la empresa desde la que administras la plataforma' },
        { status: 409 },
      );
    }

    const confirmName =
      body && typeof body.confirm_name === 'string' ? body.confirm_name.trim() : '';
    if (confirmName.toLowerCase() !== String(account.name).trim().toLowerCase()) {
      return NextResponse.json(
        { error: 'El nombre de confirmación no coincide con el de la empresa' },
        { status: 400 },
      );
    }

    const warnings: string[] = [];

    // Members whose auth accounts we must delete after the row cascade.
    const { data: members } = await admin
      .from('profiles')
      .select('user_id')
      .eq('account_id', id);
    const memberUserIds = new Set<string>(
      (members ?? []).map((m) => m.user_id as string).filter(Boolean),
    );
    if (account.owner_user_id) memberUserIds.add(account.owner_user_id as string);

    // 1. Storage — one prefixed folder per account per bucket.
    for (const bucket of ACCOUNT_SCOPED_BUCKETS) {
      try {
        const prefix = `account-${id}`;
        // Flat layout (`account-<id>/<file>`); page in case of many files.
        for (let offset = 0; ; offset += 1000) {
          const { data: files, error } = await admin.storage
            .from(bucket)
            .list(prefix, { limit: 1000, offset });
          if (error) {
            warnings.push(`storage ${bucket}: ${error.message}`);
            break;
          }
          if (!files || files.length === 0) break;
          const paths = files.map((f) => `${prefix}/${f.name}`);
          const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
          if (rmErr) warnings.push(`storage ${bucket}: ${rmErr.message}`);
          if (files.length < 1000) break;
        }
      } catch (err) {
        warnings.push(
          `storage ${bucket}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. Platform-level rows that only SET NULL on account delete.
    for (const table of ['platform_company_invitations', 'support_tickets']) {
      const { error } = await admin.from(table).delete().eq('account_id', id);
      if (error) warnings.push(`${table}: ${error.message}`);
    }

    // 3. The account row — cascades every tenant table.
    const { error: delErr } = await admin.from('accounts').delete().eq('id', id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    // 4. Member auth accounts (not covered by the DB cascade).
    let deletedMembers = 0;
    for (const userId of memberUserIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) warnings.push(`auth user ${userId}: ${error.message}`);
      else deletedMembers += 1;
    }

    return NextResponse.json({
      ok: true,
      deleted: { company: account.name, members: deletedMembers },
      warnings,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
