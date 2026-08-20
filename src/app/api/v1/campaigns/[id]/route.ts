// ============================================================
// GET /api/v1/campaigns/{id} — campaign status + counts
// (scope: campaigns:read).
//
// Poll this while a campaign is 'sending'. `pending_count` is the
// "quantidade pendente" the dashboard's own campaign detail page
// shows. Account-scoped: a foreign id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getCampaign } from '@/lib/api/v1/campaigns';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'campaigns:read');
    const { id } = await params;

    const campaign = await getCampaign(ctx.supabase, ctx.accountId, id);
    if (!campaign) return fail('not_found', 'Campaign not found', 404);
    return ok(campaign);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
