import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getCounts } from '@/lib/listmonk/client';
import { isListmonkEnabled } from '@/lib/listmonk/config';

/**
 * GET /api/email/stats — counts for the unified dashboard tile.
 *
 * Degrades to nulls rather than erroring: the WhatsApp dashboard must
 * still render if the email side is down or unconfigured.
 */
export async function GET() {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  if (!isListmonkEnabled()) {
    return NextResponse.json({ configured: false, counts: null });
  }

  try {
    const counts = await getCounts();
    return NextResponse.json({ configured: true, counts });
  } catch {
    return NextResponse.json({ configured: true, counts: null });
  }
}
