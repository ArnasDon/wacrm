// ============================================================
// PATCH  /api/account/webhooks/[id] — update url/events/is_active
// DELETE /api/account/webhooks/[id] — remove an endpoint
//
// Session-authenticated counterpart to /api/v1/webhooks/[id] — see
// that file's identical business logic. Admin+ (settings-class,
// matches webhook_endpoints_update/delete RLS). A foreign id → 404,
// never 403 (account_id filter, not just RLS).
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizeEvents } from '@/lib/webhooks/events';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if ('url' in body) {
      const url = normalizeWebhookUrl(body.url);
      if (!url) {
        return NextResponse.json({ error: "'url' must be a valid https:// URL" }, { status: 400 });
      }
      updates.url = url;
    }

    if ('events' in body) {
      const events = normalizeEvents(body.events);
      if (!events) {
        return NextResponse.json(
          { error: "'events' must be a non-empty array of known event names" },
          { status: 400 }
        );
      }
      updates.events = events;
    }

    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: "'is_active' must be a boolean" }, { status: 400 });
      }
      updates.is_active = body.is_active;
      // Re-enabling a disabled endpoint clears its failure streak so it
      // isn't instantly re-disabled by a single stale failure.
      if (body.is_active === true) updates.failure_count = 0;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/account/webhooks/[id]] update error:', error);
      return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

    return NextResponse.json({ webhook: serializeWebhookEndpoint(data as Record<string, unknown>) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await context.params;

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/account/webhooks/[id]] delete error:', error);
      return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
