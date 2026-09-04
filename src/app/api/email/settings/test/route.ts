import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getSettings, testSmtp } from '@/lib/listmonk/client';
import { toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';
import { isMaskedSecret } from '@/lib/listmonk/settings';

/**
 * POST /api/email/settings/test  { email, smtp }
 *
 * Sends one message through the supplied SMTP config WITHOUT saving
 * it, so an operator can verify credentials before committing them.
 */
export async function POST(request: Request) {
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const to = String(body?.email ?? '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return NextResponse.json(
      { error: 'A valid destination email is required' },
      { status: 400 }
    );
  }

  const smtp = body?.smtp ?? {};
  let password = String(smtp.password ?? '');

  try {
    // The form shows a mask for an already-stored password. The test
    // endpoint takes a literal config and does no UUID matching, so
    // the mask would be sent as the actual password and the test
    // would fail for the wrong reason. Substitute the real stored
    // secret in that case.
    if (isMaskedSecret(password) || password === '') {
      const current = await getSettings();
      const servers = Array.isArray(current.smtp)
        ? (current.smtp as Array<{ password?: string }>)
        : [];
      // Reading settings returns the mask too, so this only helps when
      // listmonk hands back a real value; otherwise we send empty and
      // let the SMTP server reject it with a truthful error.
      password =
        servers[0]?.password && !isMaskedSecret(servers[0].password)
          ? servers[0].password
          : '';
    }

    await testSmtp(
      {
        enabled: true,
        host: String(smtp.host ?? '').trim(),
        port: Number(smtp.port) || 587,
        auth_protocol: smtp.auth_protocol ?? 'plain',
        username: String(smtp.username ?? ''),
        password,
        tls_type: smtp.tls_type ?? 'STARTTLS',
        tls_skip_verify: Boolean(smtp.tls_skip_verify),
        max_conns: 1,
        idle_timeout: '2s',
        wait_timeout: '2s',
      },
      to
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
