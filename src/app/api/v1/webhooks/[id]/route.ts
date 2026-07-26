// ============================================================
// GET    /api/v1/webhooks/{id} — read an endpoint   (webhooks:manage)
// PATCH  /api/v1/webhooks/{id} — update url/events/is_active
// DELETE /api/v1/webhooks/{id} — remove an endpoint
//
// All account-scoped: a foreign id → 404 (never 403). The signing
// secret is never returned here — it's shown once at creation only.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { normalizeEvents } from '@/lib/webhooks/events';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/webhooks] read error:', error);
      return fail('internal', 'Failed to read webhook', 500);
    }
    if (!data) return fail('not_found', 'Webhook not found', 404);

    return ok(serializeWebhookEndpoint(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const updates: Record<string, unknown> = {};

    if ('url' in body) {
      const url = normalizeWebhookUrl(body.url);
      if (!url) {
        return fail('bad_request', "'url' must be a valid https:// URL", 400);
      }
      updates.url = url;
    }

    if ('events' in body) {
      const events = normalizeEvents(body.events);
      if (!events) {
        return fail(
          'bad_request',
          "'events' must be a non-empty array of known event names",
          400
        );
      }
      updates.events = events;
    }

    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return fail('bad_request', "'is_active' must be a boolean", 400);
      }
      updates.is_active = body.is_active;
      // Re-enabling a disabled endpoint clears its failure streak so it
      // isn't instantly re-disabled by a single stale failure.
      if (body.is_active === true) updates.failure_count = 0;
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'No updatable fields provided', 400);
    }

    // Scope the update by account_id so a foreign id touches nothing;
    // the returned row (null when unmatched) drives the 404.
    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/webhooks] update error:', error);
      return fail('internal', 'Failed to update webhook', 500);
    }
    if (!data) return fail('not_found', 'Webhook not found', 404);

    return ok(serializeWebhookEndpoint(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[api/v1/webhooks] delete error:', error);
      return fail('internal', 'Failed to delete webhook', 500);
    }
    if (!data) return fail('not_found', 'Webhook not found', 404);

    return ok({ id: data.id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
