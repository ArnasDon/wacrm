// ============================================================
// GET /api/account/webhooks/[id]/deliveries — recent delivery log for
// one endpoint (Settings UI). Any member can read it (same visibility
// as the endpoint roster) — see webhook_deliveries_select RLS
// (migration 051).
// ============================================================

import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

const DELIVERIES_COLUMNS =
  'id, event, status, attempt_count, next_retry_at, last_attempt_at, response_status, response_snippet, created_at';
const PAGE_SIZE = 25;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await context.params;

    // Confirm the endpoint belongs to this account before returning
    // anything scoped to it — RLS already enforces this on the
    // deliveries query itself (account_id filter below), but this
    // turns "endpoint doesn't exist / isn't yours" into a clean 404
    // instead of an empty list that looks like "no deliveries yet".
    const { data: endpoint } = await ctx.supabase
      .from('webhook_endpoints')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!endpoint) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('webhook_deliveries')
      .select(DELIVERIES_COLUMNS)
      .eq('endpoint_id', id)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      console.error('[GET /api/account/webhooks/[id]/deliveries] error:', error);
      return NextResponse.json({ error: 'Failed to load deliveries' }, { status: 500 });
    }

    return NextResponse.json({ deliveries: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
