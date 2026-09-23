// ============================================================
// POST /api/v1/broadcasts — launch a template broadcast
// (scope: broadcasts:send).
//
// Body:
//   {
//     "name": "July promo",                 // optional label
//     "template_name": "promo_july",        // required, approved template
//     "template_language": "en_US",         // optional (default en_US)
//     "recipients": [                        // required, 1..1000
//       { "to": "+14155550123", "params": ["Jane"] },
//       { "to": "+14155550124" }
//     ]
//   }
//
// The broadcast + its recipient rows are persisted synchronously, then
// the Meta fan-out runs in `after()` so the request returns fast. Poll
// `GET /api/v1/broadcasts/{id}` for progress.
//
// Response (202):
//   { "data": { "broadcast_id", "status": "sending",
//               "total_recipients", "accepted", "rejected" } }
// ============================================================

import { after } from 'next/server';

import { requireApiKey } from '@/lib/auth/api-context';

// The `after()` fan-out below sends to every recipient sequentially and
// runs within this route's max duration (the same constraint the
// webhook route documents). Give it headroom beyond the platform
// default so a modest batch isn't cut off mid-send — which would leave
// recipient rows 'pending' and the broadcast stuck 'sending'. This is a
// bound, not a guarantee: a near-cap (MAX_RECIPIENTS) audience can
// still exceed 60s, so very large sends should be split across
// requests. A durable queue/cron drain is the complete fix (follow-up).
export const maxDuration = 60;
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import {
  createBroadcast,
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'broadcasts:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const templateName =
      typeof body.template_name === 'string' ? body.template_name : '';
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    const plan = await createBroadcast(
      ctx.supabase,
      ctx.accountId,
      auditUserId,
      {
        name: typeof body.name === 'string' ? body.name : null,
        templateName,
        templateLanguage:
          typeof body.template_language === 'string'
            ? body.template_language
            : null,
        recipients: recipients.map((r) => ({
          to: typeof r?.to === 'string' ? r.to : '',
          params: Array.isArray(r?.params) ? r.params : undefined,
        })),
      }
    );

    // Fan out after the response is sent. Uses the same service-role
    // client — no request-scoped auth needed for the Meta calls or
    // the account-scoped row updates.
    after(() => deliverBroadcast(ctx.supabase, plan));

    return ok(
      {
        broadcast_id: plan.broadcastId,
        status: 'sending',
        total_recipients: plan.planned.length,
        accepted: plan.planned.length,
        rejected: plan.rejected,
      },
      202
    );
  } catch (err) {
    if (err instanceof BroadcastError) {
      return fail(err.code, err.message, err.status);
    }
    if (err instanceof ContactError) {
      return fail(
        err.status === 400 ? 'bad_request' : 'internal',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
