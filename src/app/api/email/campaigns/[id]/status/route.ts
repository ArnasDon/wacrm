import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { setCampaignStatus } from '@/lib/listmonk/client';
import { parseId, toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';
import type { ListmonkCampaignStatus } from '@/lib/listmonk/types';

// Only transitions a human should be able to drive from this UI.
// `finished` is listmonk's own terminal state — set by its sender,
// never by us.
const ALLOWED: ListmonkCampaignStatus[] = [
  'running',
  'paused',
  'cancelled',
  'scheduled',
  'draft',
];

/**
 * PUT /api/email/campaigns/:id/status
 *
 * This is the endpoint that actually puts mail in flight, so it is
 * the one place in the Email section gated above read level. Starting
 * a campaign is the email equivalent of launching a WhatsApp
 * broadcast — `agent` and up, matching send-messages.
 */
export async function PUT(
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
  const status = body?.status as ListmonkCampaignStatus | undefined;

  if (!status || !ALLOWED.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const campaign = await setCampaignStatus(id, status);
    return NextResponse.json({ campaign });
  } catch (err) {
    // listmonk enforces the state machine (you cannot resume a
    // finished campaign); its 400 message is more useful than
    // anything we'd invent, so it passes through.
    return toListmonkErrorResponse(err);
  }
}
