// ============================================================
// POST /api/account/webhooks/[id]/deliveries/[deliveryId]/retry
//
// "Retry now" button — resets a failed/pending delivery's
// `next_retry_at` to now() so the next cron sweep (or, if configured
// to run frequently, within a minute) picks it up. Doesn't attempt
// delivery inline — reuses the same retry path as the scheduled cron
// so there's exactly one place that knows how to replay a delivery.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/webhooks/admin-client';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; deliveryId: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id, deliveryId } = await context.params;

    // Ownership check via the RLS-scoped session client — confirms the
    // delivery belongs to an endpoint in the caller's account before
    // the service-role write below touches it.
    const { data: delivery } = await ctx.supabase
      .from('webhook_deliveries')
      .select('id, status')
      .eq('id', deliveryId)
      .eq('endpoint_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!delivery) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
    }
    if (delivery.status === 'delivered') {
      return NextResponse.json({ error: 'This delivery already succeeded' }, { status: 400 });
    }

    const { error } = await supabaseAdmin()
      .from('webhook_deliveries')
      .update({ status: 'pending', next_retry_at: new Date().toISOString() })
      .eq('id', deliveryId);

    if (error) {
      console.error('[POST /api/account/webhooks/.../retry] update error:', error);
      return NextResponse.json({ error: 'Failed to schedule retry' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
