// ============================================================
// GET  /api/v1/webhooks — list webhook endpoints (scope: webhooks:manage)
// POST /api/v1/webhooks — register an endpoint    (scope: webhooks:manage)
//
// POST returns the signing `secret` in plaintext exactly once — store
// it to verify the `X-Wacrm-Signature` on deliveries. wacrm keeps only
// an encrypted copy and can never show it again.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import { normalizeEvents } from '@/lib/webhooks/events';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
  generateWebhookSecret,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/webhooks] list error:', error);
      return fail('internal', 'Failed to list webhooks', 500);
    }

    // The roster is small and settings-class — return it whole (the
    // list envelope's cursor is always null here).
    return okList(
      (data ?? []).map((r) =>
        serializeWebhookEndpoint(r as Record<string, unknown>)
      ),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const url = normalizeWebhookUrl(body.url);
    if (!url) {
      return fail('bad_request', "'url' must be a valid https:// URL", 400);
    }

    const events = normalizeEvents(body.events);
    if (!events) {
      return fail(
        'bad_request',
        "'events' must be a non-empty array of known event names",
        400
      );
    }

    const secret = generateWebhookSecret();

    const { data: created, error } = await ctx.supabase
      .from('webhook_endpoints')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.createdBy,
        url,
        secret: encrypt(secret),
        events,
      })
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single();

    if (error || !created) {
      console.error('[api/v1/webhooks] create error:', error);
      return fail('internal', 'Failed to create webhook', 500);
    }

    // Secret shown exactly once.
    return ok(
      {
        ...serializeWebhookEndpoint(created as Record<string, unknown>),
        secret,
      },
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
