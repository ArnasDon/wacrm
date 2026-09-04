import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getSettings, updateSettings } from '@/lib/listmonk/client';
import { toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';
import {
  mergeSmtpSettings,
  toEmailSettings,
  type EmailSettings,
} from '@/lib/listmonk/settings';

/**
 * GET /api/email/settings
 *
 * Admin-only: SMTP credentials are account-wide infrastructure, the
 * same bar as the WhatsApp access token.
 *
 * The password comes back from listmonk already masked as bullets;
 * we pass that through so the form can show "something is set"
 * without ever handing the real secret to a browser.
 */
export async function GET() {
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const raw = await getSettings();
    return NextResponse.json({ settings: toEmailSettings(raw) });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}

/**
 * PUT /api/email/settings
 *
 * Reads the CURRENT full settings document and folds the operator's
 * edits into it. listmonk's PUT replaces the whole document, so
 * posting only our fields would reset every other setting to empty —
 * the read-modify-write is load-bearing, not defensive.
 */
export async function PUT(request: Request) {
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const host = String(body?.smtp?.host ?? '').trim();
  const fromEmail = String(body?.fromEmail ?? '').trim();
  if (!host) {
    return NextResponse.json(
      { error: 'SMTP host is required' },
      { status: 400 }
    );
  }
  if (!fromEmail) {
    return NextResponse.json(
      { error: 'From address is required' },
      { status: 400 }
    );
  }

  const port = Number(body?.smtp?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: 'Invalid SMTP port' }, { status: 400 });
  }

  const edits: EmailSettings = {
    fromEmail,
    siteName: String(body?.siteName ?? '').trim(),
    rootUrl: String(body?.rootUrl ?? '').trim(),
    smtp: {
      enabled: true,
      host,
      port,
      auth_protocol: body?.smtp?.auth_protocol ?? 'plain',
      username: String(body?.smtp?.username ?? ''),
      password: String(body?.smtp?.password ?? ''),
      tls_type: body?.smtp?.tls_type ?? 'STARTTLS',
      tls_skip_verify: Boolean(body?.smtp?.tls_skip_verify),
    },
  };

  try {
    const current = await getSettings();
    await updateSettings(mergeSmtpSettings(current, edits));
    // listmonk restarts itself to rebuild the SMTP pool. Tell the UI
    // so it can wait rather than immediately re-reading through a
    // door that is briefly shut.
    return NextResponse.json({ ok: true, restarting: true });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
