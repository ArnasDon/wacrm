import { after } from 'next/server';
import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiBody,
} from '@/lib/auth/api-context-local';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getPool } from '@/lib/db/pool';
import {
  createBroadcast,
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const ctx = await requireLocalApiKey(request, 'broadcasts:send');
    const body = await apiBody(request);
    const plan = await withApiKeyAccount(ctx, 'broadcasts:send', (db, userId) =>
      createBroadcast(db, ctx.accountId, userId, {
        name: typeof body.name === 'string' ? body.name : null,
        templateName:
          typeof body.template_name === 'string' ? body.template_name : '',
        templateLanguage:
          typeof body.template_language === 'string'
            ? body.template_language
            : null,
        recipients: Array.isArray(body.recipients) ? body.recipients : [],
      })
    );
    after(() => deliverBroadcast(getPool('worker'), plan));
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
  } catch (error) {
    if (error instanceof BroadcastError)
      return fail(error.code, error.message, error.status);
    return toApiErrorResponse(error);
  }
}
