import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  routeAssignment,
  commitAssignment,
  resolveMarketRegionFromContact,
} from '@/lib/routing/service';
import { writeEngagementEvent } from '@/lib/whatsapp/engagement';
import { writeProductInteraction } from '@/lib/analytics/product-interaction';

// GET  /api/trials — list this account's Trials. POST creates one and
// runs §12's routing. `trials.assigned_ba_id` targets auth.users(id)
// directly (migration 045), same as customer_requests — no
// profiles.id translation needed here, unlike `deals.assigned_to`.

export async function GET(request: Request) {
  try {
    const { supabase, userId } = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const productId = searchParams.get('product_id');
    const mine = searchParams.get('mine') === 'true';

    let query = supabase
      .from('trials')
      .select(
        '*, contact:contacts(id, name, phone), product:products(id, product_name)'
      )
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (productId) query = query.eq('product_id', productId);
    if (mine) query = query.eq('assigned_ba_id', userId);

    const { data, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ trials: data ?? [] });
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

    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phone) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 });
    }

    const contactId =
      typeof body.contact_id === 'string' ? body.contact_id : null;
    const productId =
      typeof body.product_id === 'string' ? body.product_id : null;
    const customerRequestId =
      typeof body.customer_request_id === 'string'
        ? body.customer_request_id
        : null;

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
      .from('trials')
      .insert({
        account_id: accountId,
        contact_id: contactId,
        product_id: productId,
        customer_request_id: customerRequestId,
        name: typeof body.name === 'string' ? body.name : null,
        phone,
        role: typeof body.role === 'string' ? body.role : null,
        market: typeof body.market === 'string' ? body.market : null,
        vehicle: typeof body.vehicle === 'string' ? body.vehicle : null,
        notes: typeof body.notes === 'string' ? body.notes : null,
        status: decision.assignedBaId ? 'ASSIGNED' : 'REQUESTED',
        assigned_ba_id: decision.assignedBaId,
        routing_reason: decision.reason,
      })
      .select(
        '*, contact:contacts(id, name, phone), product:products(id, product_name)'
      )
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    if (decision.assignedBaId) {
      await commitAssignment(supabase, {
        previousBaId: null,
        nextBaId: decision.assignedBaId,
      });
    }

    const admin = supabaseAdmin();
    await writeEngagementEvent(admin, {
      accountId,
      memberId: contactId,
      postId: null,
      eventType: 'TRIAL',
      source: 'manual',
    });
    await writeProductInteraction(admin, {
      accountId,
      contactId,
      productId,
      interactionType: 'trial_request',
    });

    return NextResponse.json({ trial: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
