import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { ping } from '@/lib/listmonk/client';
import { isListmonkEnabled } from '@/lib/listmonk/config';

/**
 * GET /api/email/health
 *
 * Three-state probe the Email section renders against:
 *   { configured: false }                     → operator hasn't wired it up
 *   { configured: true, reachable: false }    → wrong URL / creds / down
 *   { configured: true, reachable: true }     → ready
 *
 * Always 200 (except auth) so the UI can render guidance rather than
 * an error boundary — same convention as /api/whatsapp/config.
 */
export async function GET() {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  if (!isListmonkEnabled()) {
    return NextResponse.json({ configured: false, reachable: false });
  }

  const result = await ping();
  if (!result.ok) {
    return NextResponse.json({
      configured: true,
      reachable: false,
      error: result.error,
      status: result.status,
    });
  }

  return NextResponse.json({
    configured: true,
    reachable: true,
    version: result.version,
  });
}
