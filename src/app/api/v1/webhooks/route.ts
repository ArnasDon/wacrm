import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiBody,
} from '@/lib/auth/api-context-local';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import { normalizeEvents } from '@/lib/webhooks/events';
import {
  generateWebhookSecret,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints';
import { createWebhook, listWebhooks } from '@/lib/db/webhooks';

export async function GET(request: Request) {
  try {
    const ctx = await requireLocalApiKey(request, 'webhooks:manage');
    return okList(
      await withApiKeyAccount(ctx, 'webhooks:manage', (db) =>
        listWebhooks(db, ctx.accountId)
      ),
      null
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requireLocalApiKey(request, 'webhooks:manage');
    const body = await apiBody(request);
    const url = normalizeWebhookUrl(body.url);
    if (!url)
      return fail('bad_request', "'url' must be a valid https:// URL", 400);
    const events = normalizeEvents(body.events);
    if (!events)
      return fail(
        'bad_request',
        "'events' must be a non-empty array of known event names",
        400
      );
    const secret = generateWebhookSecret();
    const created = await withApiKeyAccount(
      ctx,
      'webhooks:manage',
      (db, userId) =>
        createWebhook(db, ctx.accountId, userId, {
          url,
          events,
          secret: encrypt(secret),
        })
    );
    return ok({ ...created, secret }, 201);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
