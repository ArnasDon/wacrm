import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { testCampaign } from '@/lib/listmonk/client';
import { parseId, toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

/**
 * POST /api/email/campaigns/:id/test  { emails: string[] }
 *
 * Sends the campaign to a handful of addresses so the author can read
 * it in a real inbox before it goes to the list.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const emails: string[] = Array.isArray(body?.emails)
    ? body.emails
        .map((e: unknown) => String(e).trim())
        .filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))
    : [];

  if (emails.length === 0) {
    return NextResponse.json(
      { error: 'At least one valid email address is required' },
      { status: 400 }
    );
  }

  try {
    await testCampaign(id, emails);
    return NextResponse.json({ ok: true, sent: emails.length });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
