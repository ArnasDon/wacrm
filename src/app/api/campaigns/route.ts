import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// GET  /api/campaigns — list this account's campaigns (any member).
// POST /api/campaigns — create one. agent+ (not admin-only) — migration
// 043's RLS tier matches deals/broadcasts: a BA can run a campaign, not
// just an admin.

export async function GET(request: Request) {
  try {
    const { supabase } = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabase
      .from('campaigns')
      .select('*, product:products(id, product_name)')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ campaigns: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const campaignName =
      typeof body.campaign_name === 'string' ? body.campaign_name.trim() : '';
    if (!campaignName) {
      return NextResponse.json(
        { error: 'campaign_name is required' },
        { status: 400 }
      );
    }

    for (const field of ['start_date', 'end_date'] as const) {
      if (
        body[field] !== undefined &&
        body[field] !== null &&
        (typeof body[field] !== 'string' || !DATE_RE.test(body[field]))
      ) {
        return NextResponse.json(
          { error: `${field} must be a YYYY-MM-DD date string` },
          { status: 400 }
        );
      }
    }

    let cost: number | null = null;
    if (body.cost !== undefined && body.cost !== null) {
      const parsed = Number(body.cost);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json(
          { error: 'cost must be a non-negative number' },
          { status: 400 }
        );
      }
      cost = parsed;
    }

    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        account_id: accountId,
        campaign_name: campaignName,
        product_id:
          typeof body.product_id === 'string' ? body.product_id : null,
        start_date: body.start_date ?? null,
        end_date: body.end_date ?? null,
        objective: typeof body.objective === 'string' ? body.objective : null,
        content: typeof body.content === 'string' ? body.content : null,
        audience:
          body.audience && typeof body.audience === 'object'
            ? body.audience
            : {},
        cost,
        status: 'draft',
        created_by: userId,
      })
      .select('*, product:products(id, product_name)')
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ campaign: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
