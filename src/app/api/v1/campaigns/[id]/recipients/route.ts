// ============================================================
// GET  /api/v1/campaigns/{id}/recipients — list recipients + status
//      (scope: campaigns:read). Optional `?status=pending|sent|...`.
// POST /api/v1/campaigns/{id}/recipients — add recipients
//      (scope: campaigns:write). Idempotent: a contact already on the
//      campaign is silently skipped (migration 075's unique index) —
//      retrying this call never double-adds anyone.
//
// POST body: { "recipients": [{ "to": "+5511999999999" }, ...] }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams } from '@/lib/api/v1/pagination';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import { listCampaignRecipients, addCampaignRecipients } from '@/lib/api/v1/campaigns';
import { BroadcastError } from '@/lib/whatsapp/broadcast-core';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'campaigns:read');
    const { id } = await params;
    const { limit, cursor } = parseListParams(request);
    const status = new URL(request.url).searchParams.get('status') ?? undefined;

    const { items, nextCursor } = await listCampaignRecipients(
      ctx.supabase,
      ctx.accountId,
      id,
      { limit, cursor, status: status ?? undefined }
    );
    return okList(items, nextCursor);
  } catch (err) {
    if (err instanceof BroadcastError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'campaigns:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const recipients = Array.isArray(body?.recipients) ? body.recipients : [];
    if (recipients.length === 0) {
      return fail('bad_request', "'recipients' must be a non-empty array of { to }", 400);
    }

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const result = await addCampaignRecipients(
      ctx.supabase,
      ctx.accountId,
      auditUserId,
      id,
      {
        recipients: recipients.map((r) => ({ to: typeof r?.to === 'string' ? r.to : '' })),
      }
    );

    return ok(result, 201);
  } catch (err) {
    if (err instanceof BroadcastError) return fail(err.code, err.message, err.status);
    if (err instanceof ContactError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
