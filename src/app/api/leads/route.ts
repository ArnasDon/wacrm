import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createLead } from '@/lib/routing/create-lead';

// GET  /api/leads — list this account's Leads (`deals` extended per
// §9.0/migration 055). POST creates one and runs §12's routing.
//
// "Lead" here is every row in `deals` — Rimula doesn't distinguish a
// generic Kanban deal from a Lead; extending `deals` IS the Lead
// entity (§23 phase 6), so this and the Pipelines Kanban page read
// the same table from two different lenses.

const SOURCES = [
  'demo_whatsapp',
  'whatsapp',
  'product_page',
  'campaign',
  'manual',
  'flow',
  'customer_request',
] as const;

export async function GET(request: Request) {
  try {
    const { supabase, userId } = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const marketId = searchParams.get('market_id');
    const regionId = searchParams.get('region_id');
    const campaignId = searchParams.get('campaign_id');
    const mine = searchParams.get('mine') === 'true';
    const overdue = searchParams.get('overdue') === 'true';

    let query = supabase
      .from('deals')
      .select(
        '*, contact:contacts(id, name, phone), assignee:profiles!deals_assigned_to_fkey(id, user_id, full_name), campaign:campaigns(id, campaign_name)'
      )
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (marketId) query = query.eq('market_id', marketId);
    if (regionId) query = query.eq('region_id', regionId);
    if (campaignId) query = query.eq('campaign_id', campaignId);
    if (overdue) query = query.lt('next_follow_up', new Date().toISOString());

    if (mine) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      if (!profile?.id) return NextResponse.json({ leads: [] });
      query = query.eq('assigned_to', profile.id);
    }

    const { data, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ leads: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const contactId =
      typeof body.contact_id === 'string' ? body.contact_id : '';
    if (!contactId) {
      return NextResponse.json(
        { error: 'contact_id is required — a Lead must be linked to a Member' },
        { status: 400 }
      );
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    let source = 'manual';
    if (body.source !== undefined) {
      if (!(SOURCES as readonly string[]).includes(body.source)) {
        return NextResponse.json(
          { error: `source must be one of: ${SOURCES.join(', ')}` },
          { status: 400 }
        );
      }
      source = body.source;
    }

    let value = 0;
    if (body.value !== undefined && body.value !== null) {
      const parsed = Number(body.value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json(
          { error: 'value must be a non-negative number' },
          { status: 400 }
        );
      }
      value = parsed;
    }

    const lead = await createLead(supabase, {
      accountId,
      userId,
      contactId,
      title,
      value,
      currency: typeof body.currency === 'string' ? body.currency : null,
      source,
      campaignId:
        typeof body.campaign_id === 'string' ? body.campaign_id : null,
      originalContentId:
        typeof body.original_content_id === 'string'
          ? body.original_content_id
          : null,
      marketId: typeof body.market_id === 'string' ? body.market_id : null,
      regionId: typeof body.region_id === 'string' ? body.region_id : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    });

    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith('Failed to create Lead')
    ) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
