// ============================================================
// POST /api/v1/campaigns/{id}/recipients/{recipientId}/result
// (scope: campaigns:write)
//
// The external executor (spec section 4) calls this after it has
// already sent a message via WhatsApp Web — WACRM never sends for an
// 'external' campaign itself, it only records what happened. Scoped
// under campaigns:write (not broadcasts:send) because this endpoint
// can't trigger a send; it only writes a result for one that already
// happened outside WACRM.
//
// Body:
//   { "status": "sent", "sent_at"?, "external_reference"? }
//   { "status": "failed", "error_message"? }
//
// Idempotent: reporting a result for a recipient that isn't `pending`
// anymore (already reported, or otherwise resolved) is a no-op —
// `{ "data": { "updated": false, "status": "<current status>" } }`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { reportRecipientResult } from '@/lib/api/v1/campaigns';
import { BroadcastError } from '@/lib/whatsapp/broadcast-core';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'campaigns:write');
    const { id, recipientId } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const status = body?.status;
    if (status !== 'sent' && status !== 'failed') {
      return fail('bad_request', "'status' must be 'sent' or 'failed'", 400);
    }

    const result = await reportRecipientResult(ctx.supabase, ctx.accountId, id, recipientId, {
      status,
      sentAt: typeof body?.sent_at === 'string' ? body.sent_at : undefined,
      errorMessage: typeof body?.error_message === 'string' ? body.error_message : undefined,
      externalReference:
        typeof body?.external_reference === 'string' ? body.external_reference : undefined,
    });

    return ok(result);
  } catch (err) {
    if (err instanceof BroadcastError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
