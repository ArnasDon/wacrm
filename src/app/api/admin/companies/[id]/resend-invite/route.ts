import { NextResponse } from 'next/server';
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import { platformAdminClient } from '@/lib/platform/admin-client';
import { platformInviteRedirectUrl } from '@/lib/http/base-url';

/**
 * POST /api/admin/companies/[id]/resend-invite
 *
 * Platform-admin only. Re-sends an access email to a company's owner —
 * for when the original invite link was consumed, expired, or misused
 * and the owner can no longer get in.
 *
 * - Owner already has a confirmed auth account (the common case): sends
 *   a password-recovery email (Supabase SMTP), landing them on
 *   `/reset-password` via `/auth/callback` so they set a fresh password.
 * - Owner exists but was never confirmed / no account bootstrapped yet:
 *   re-issues the invite, falling back to recovery if the user row
 *   already exists.
 *
 * Never changes the account, the profile, or the invitation row — it
 * only re-sends an email.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
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

    // The email the owner actually signs in with; fall back to the
    // original invitation email if the profile has none.
    const { data: owner } = await admin
      .from('profiles')
      .select('email, full_name')
      .eq('account_id', id)
      .eq('account_role', 'owner')
      .maybeSingle();
    let email = (owner?.email ?? '').trim().toLowerCase();
    if (!email) {
      const { data: invite } = await admin
        .from('platform_company_invitations')
        .select('invited_email')
        .eq('account_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      email = (invite?.invited_email ?? '').trim().toLowerCase();
    }
    if (!email) {
      return NextResponse.json(
        { error: 'No hay un correo registrado para esta empresa' },
        { status: 400 },
      );
    }

    const redirectTo = platformInviteRedirectUrl(request);

    let confirmed = false;
    if (account.owner_user_id) {
      const { data: userRes } = await admin.auth.admin.getUserById(
        account.owner_user_id as string,
      );
      confirmed = Boolean(userRes.user?.email_confirmed_at);
    }

    if (confirmed) {
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        console.error('[resend-invite] resetPasswordForEmail failed:', error.message);
        return NextResponse.json(
          { error: 'No se pudo enviar el correo de acceso' },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, mode: 'recovery', email });
    }

    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: (owner?.full_name as string) || account.name },
      redirectTo,
    });
    if (!inviteErr) {
      return NextResponse.json({ ok: true, mode: 'invite', email });
    }

    // The user row already exists but isn't confirmed — a recovery link
    // both confirms the email and lets them set a password.
    const { error: recErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (recErr) {
      console.error('[resend-invite] fallback recovery failed:', recErr.message);
      return NextResponse.json(
        { error: 'No se pudo reenviar la invitación' },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, mode: 'recovery', email });
  } catch (error) {
    return toErrorResponse(error);
  }
}
