// ============================================================
// GET /api/v1/contacts/{id}/campaigns — "which campaigns has this
// lead received, and what happened" (scope: campaigns:read).
//
// Wraps migration 075's get_contact_campaign_history RPC. Answers the
// spec's example question directly: "Quais campanhas esse cliente já
// recebeu?"
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getContactCampaignHistory } from '@/lib/api/v1/campaigns';
import { BroadcastError } from '@/lib/whatsapp/broadcast-core';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'campaigns:read');
    const { id } = await params;
    const history = await getContactCampaignHistory(ctx.supabase, ctx.accountId, id);
    return okList(history, null);
  } catch (err) {
    if (err instanceof BroadcastError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
