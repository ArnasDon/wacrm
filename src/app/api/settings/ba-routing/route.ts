import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// GET/PATCH /api/settings/ba-routing — §15's "BA routing rules"
// Settings area. Any member reads; only admin+ writes (matches
// `ba_routing_settings` RLS, migration 056).

const STRATEGIES = ['round_robin', 'lowest_open_leads', 'manual'] as const;

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { data, error } = await supabase
      .from('ba_routing_settings')
      .select('strategy')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    // No row yet is a valid state — the routing service itself
    // defaults to 'lowest_open_leads' (src/lib/routing/service.ts).
    return NextResponse.json({
      strategy: data?.strategy ?? 'lowest_open_leads',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    if (!(STRATEGIES as readonly string[]).includes(body.strategy)) {
      return NextResponse.json(
        { error: `strategy must be one of: ${STRATEGIES.join(', ')}` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('ba_routing_settings')
      .upsert(
        { account_id: accountId, strategy: body.strategy },
        { onConflict: 'account_id' }
      )
      .select('strategy')
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ strategy: data.strategy });
  } catch (err) {
    return toErrorResponse(err);
  }
}
