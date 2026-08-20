// ============================================================
// GET  /api/v1/campaigns  — list campaigns (scope: campaigns:read)
// POST /api/v1/campaigns  — create a campaign (scope: campaigns:write)
//
// A campaign IS a `broadcasts` row (migration 075) — Campaigns is a
// planning/reporting layer over the existing Broadcasts send engine,
// not a second one. Creating a campaign here NEVER sends anything —
// see POST /api/v1/campaigns/{id}/send, which requires the separate
// 'broadcasts:send' scope plus an explicit `confirm: true` (spec
// section 10: a read query must never be able to trigger a send).
//
// POST body:
//   {
//     "name": "Investidores até 350 mil",
//     "description": "optional planning note",
//     "template_name": "promo_investidores",
//     "template_language": "pt_BR",
//     "recipients": [                      // optional — omit to create a draft
//       { "to": "+5511999999999" }
//     ]
//   }
//
// Response (201): { "data": <campaign> } — status is 'ready' when
// recipients were supplied, 'draft' otherwise.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams } from '@/lib/api/v1/pagination';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import { listCampaigns, createCampaign } from '@/lib/api/v1/campaigns';
import { BroadcastError } from '@/lib/whatsapp/broadcast-core';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'campaigns:read');
    const { limit, cursor } = parseListParams(request);
    const { items, nextCursor } = await listCampaigns(ctx.supabase, ctx.accountId, {
      limit,
      cursor,
    });
    return okList(items, nextCursor);
  } catch (err) {
    if (err instanceof BroadcastError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'campaigns:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return fail('bad_request', "'name' is required", 400);

    const templateName =
      typeof body.template_name === 'string' ? body.template_name : '';
    if (!templateName) {
      return fail('bad_request', "'template_name' is required", 400);
    }

    const rawRecipients = Array.isArray(body.recipients) ? body.recipients : undefined;

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    const campaign = await createCampaign(ctx.supabase, ctx.accountId, auditUserId, {
      name,
      description: typeof body.description === 'string' ? body.description : null,
      templateName,
      templateLanguage:
        typeof body.template_language === 'string' ? body.template_language : null,
      recipients: rawRecipients?.map((r) => ({
        to: typeof r?.to === 'string' ? r.to : '',
        params: Array.isArray(r?.params) ? r.params : undefined,
      })),
    });

    return ok(campaign, 201);
  } catch (err) {
    if (err instanceof BroadcastError) return fail(err.code, err.message, err.status);
    if (err instanceof ContactError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
