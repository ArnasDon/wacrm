import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiBody,
  apiUUID,
} from '@/lib/auth/api-context-local';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { normalizeEvents } from '@/lib/webhooks/events';
import { normalizeWebhookUrl } from '@/lib/webhooks/endpoints';
import {
  getWebhook,
  updateWebhook,
  deleteWebhook,
  type WebhookUpdate,
} from '@/lib/db/webhooks';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const ctx = await requireLocalApiKey(request, 'webhooks:manage');
    const id = apiUUID((await params).id);
    const row = await withApiKeyAccount(ctx, 'webhooks:manage', (db) =>
      getWebhook(db, ctx.accountId, id)
    );
    return row ? ok(row) : fail('not_found', 'Webhook not found', 404);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await requireLocalApiKey(request, 'webhooks:manage');
    const id = apiUUID((await params).id);
    const body = await apiBody(request);
    const updates: WebhookUpdate = {};
    if ('url' in body) {
      const url = normalizeWebhookUrl(body.url);
      if (!url)
        return fail('bad_request', "'url' must be a valid https:// URL", 400);
      updates.url = url;
    }
    if ('events' in body) {
      const events = normalizeEvents(body.events);
      if (!events)
        return fail(
          'bad_request',
          "'events' must be a non-empty array of known event names",
          400
        );
      updates.events = events;
    }
    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean')
        return fail('bad_request', "'is_active' must be a boolean", 400);
      updates.is_active = body.is_active;
    }
    if (!Object.keys(updates).length)
      return fail('bad_request', 'No updatable fields provided', 400);
    const row = await withApiKeyAccount(ctx, 'webhooks:manage', (db) =>
      updateWebhook(db, ctx.accountId, id, updates)
    );
    return row ? ok(row) : fail('not_found', 'Webhook not found', 404);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    const ctx = await requireLocalApiKey(request, 'webhooks:manage');
    const id = apiUUID((await params).id);
    const row = await withApiKeyAccount(ctx, 'webhooks:manage', (db) =>
      deleteWebhook(db, ctx.accountId, id)
    );
    return row
      ? ok({ id: row.id, deleted: true })
      : fail('not_found', 'Webhook not found', 404);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
