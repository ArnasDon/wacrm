// ============================================================
// POST /api/v1/campaigns/{id}/send — dispatch a campaign
// (scope: broadcasts:send — deliberately NOT campaigns:write).
//
// A key that only has campaigns:read/campaigns:write can list leads,
// create campaigns, and stage recipients, but can never reach this
// route — sending is gated behind the same scope + explicit
// `{ "confirm": true }` body the existing broadcasts docs describe for
// "destructive" MCP actions (spec section 10: creating/consulting a
// campaign must never be able to fire messages).
//
// Only sends `pending` recipients already on the campaign — safe to
// call again after a timeout/retry (buildPlanForExistingCampaign only
// ever plans rows still `pending`; already-sent ones are untouched).
// ============================================================

import { after } from 'next/server';

import { requireApiKey } from '@/lib/auth/api-context';
export const maxDuration = 60;
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  buildPlanForExistingCampaign,
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'broadcasts:send');
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.confirm !== true) {
      return fail(
        'confirmation_required',
        "Sending a campaign is irreversible — pass { \"confirm\": true } to proceed",
        400
      );
    }

    const plan = await buildPlanForExistingCampaign(ctx.supabase, ctx.accountId, id);
    if (plan.planned.length === 0) {
      return fail('bad_request', 'Campaign has no pending recipients to send', 400);
    }

    await ctx.supabase.from('broadcasts').update({ status: 'sending' }).eq('id', id);

    after(() => deliverBroadcast(ctx.supabase, plan));

    return ok(
      {
        campaign_id: id,
        status: 'sending',
        recipients_to_send: plan.planned.length,
      },
      202
    );
  } catch (err) {
    if (err instanceof BroadcastError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
