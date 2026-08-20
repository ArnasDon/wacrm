import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  routeAssignment,
  commitAssignment,
  resolveMarketRegionFromContact,
} from '@/lib/routing/service';
import { writeProductInteraction } from '@/lib/analytics/product-interaction';

// GET  /api/customer-requests — list this account's requests (any
// member). POST creates one and runs it through §12's
// LeadRoutingService (Market BA -> Regional BA -> Unassigned).

const TYPES = [
  'PRODUCT_INFORMATION',
  'PRODUCT_SUITABILITY',
  'TRIAL_REQUEST',
  'BA_CALL_REQUEST',
  'PRODUCT_QUESTION',
  'FEEDBACK',
  'PURCHASE_REQUEST',
  'CONVERSION_REQUEST',
  'GENERAL_ENQUIRY',
] as const;
const SOURCES = [
  'demo_whatsapp',
  'whatsapp',
  'product_page',
  'campaign',
  'manual',
  'flow',
] as const;

export async function GET(request: Request) {
  try {
    const { supabase, userId } = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const mine = searchParams.get('mine') === 'true';

    let query = supabase
      .from('customer_requests')
      .select(
        '*, contact:contacts(id, name, phone), product:products(id, product_name), campaign:campaigns(id, campaign_name)'
      )
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);
    if (mine) query = query.eq('assigned_ba_id', userId);

    const { data, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    // No FK from customer_requests.assigned_ba_id -> profiles exists
    // (it targets auth.users directly, per migration 044), so
    // PostgREST can't auto-embed the assignee. Batch-resolve names
    // for the distinct assignees on this page instead of a second
    // round trip per row.
    const requests = data ?? [];
    const baIds = [
      ...new Set(requests.map((r) => r.assigned_ba_id).filter(Boolean)),
    ];
    let namesByUserId: Record<string, string> = {};
    if (baIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', baIds);
      namesByUserId = Object.fromEntries(
        (profiles ?? []).map((p) => [p.user_id, p.full_name])
      );
    }
    const enriched = requests.map((r) => ({
      ...r,
      assignee: r.assigned_ba_id
        ? {
            user_id: r.assigned_ba_id,
            full_name: namesByUserId[r.assigned_ba_id] ?? null,
          }
        : null,
    }));

    return NextResponse.json({ customer_requests: enriched });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const type = body.type;
    if (!(TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${TYPES.join(', ')}` },
        { status: 400 }
      );
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

    const contactId =
      typeof body.contact_id === 'string' ? body.contact_id : null;
    const productId =
      typeof body.product_id === 'string' ? body.product_id : null;
    const campaignId =
      typeof body.campaign_id === 'string' ? body.campaign_id : null;
    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : null;
    const notes = typeof body.notes === 'string' ? body.notes : null;

    // §12 routing: CustomerRequest has no market/region of its own —
    // derive it from the linked Member, if any.
    const { marketId, regionId } = await resolveMarketRegionFromContact(
      supabase,
      contactId
    );
    const decision = await routeAssignment(supabase, {
      accountId,
      marketId,
      regionId,
    });

    const { data, error } = await supabase
      .from('customer_requests')
      .insert({
        account_id: accountId,
        contact_id: contactId,
        conversation_id: conversationId,
        product_id: productId,
        campaign_id: campaignId,
        type,
        source,
        status: decision.assignedBaId ? 'ASSIGNED' : 'NEW',
        assigned_ba_id: decision.assignedBaId,
        routing_reason: decision.reason,
        notes,
      })
      .select(
        '*, contact:contacts(id, name, phone), product:products(id, product_name), campaign:campaigns(id, campaign_name)'
      )
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    await commitAssignment(supabase, {
      previousBaId: null,
      nextBaId: decision.assignedBaId,
    });

    await writeProductInteraction(supabaseAdmin(), {
      accountId,
      contactId,
      productId,
      campaignId,
      interactionType: type === 'TRIAL_REQUEST' ? 'trial_request' : 'enquiry',
    });

    return NextResponse.json({ customer_request: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
