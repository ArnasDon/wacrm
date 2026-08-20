import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { commitAssignment } from '@/lib/routing/service';

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
const STATUSES = [
  'NEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
] as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('viewer');
    const { id } = await params;
    const { data, error } = await supabase
      .from('customer_requests')
      .select(
        '*, contact:contacts(id, name, phone), product:products(id, product_name), campaign:campaigns(id, campaign_name)'
      )
      .eq('id', id)
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json(
        { error: 'Customer request not found' },
        { status: 404 }
      );
    return NextResponse.json({ customer_request: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('agent');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const { data: existing, error: fetchErr } = await supabase
      .from('customer_requests')
      .select('assigned_ba_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!existing)
      return NextResponse.json(
        { error: 'Customer request not found' },
        { status: 404 }
      );

    const update: Record<string, unknown> = {};

    if (typeof body.type === 'string') {
      if (!(TYPES as readonly string[]).includes(body.type)) {
        return NextResponse.json(
          { error: `type must be one of: ${TYPES.join(', ')}` },
          { status: 400 }
        );
      }
      update.type = body.type;
    }
    if (typeof body.status === 'string') {
      if (!(STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json(
          { error: `status must be one of: ${STATUSES.join(', ')}` },
          { status: 400 }
        );
      }
      update.status = body.status;
    }
    if (typeof body.notes === 'string' || body.notes === null) {
      update.notes = body.notes;
    }

    let reassigned = false;
    let nextBaId: string | null = existing.assigned_ba_id;
    if (body.assigned_ba_id !== undefined) {
      if (
        body.assigned_ba_id !== null &&
        typeof body.assigned_ba_id !== 'string'
      ) {
        return NextResponse.json(
          { error: 'assigned_ba_id must be a string or null' },
          { status: 400 }
        );
      }
      nextBaId = body.assigned_ba_id;
      update.assigned_ba_id = nextBaId;
      update.routing_reason = nextBaId
        ? 'Manually assigned'
        : 'Manually unassigned';
      if (
        update.status === undefined &&
        nextBaId &&
        existing.assigned_ba_id !== nextBaId
      ) {
        update.status = 'ASSIGNED';
      }
      reassigned = existing.assigned_ba_id !== nextBaId;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('customer_requests')
      .update(update)
      .eq('id', id)
      .select(
        '*, contact:contacts(id, name, phone), product:products(id, product_name), campaign:campaigns(id, campaign_name)'
      )
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json(
        { error: 'Customer request not found' },
        { status: 404 }
      );

    if (reassigned) {
      await commitAssignment(supabase, {
        previousBaId: existing.assigned_ba_id,
        nextBaId,
      });
    }

    return NextResponse.json({ customer_request: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('agent');
    const { id } = await params;

    const { data: existing } = await supabase
      .from('customer_requests')
      .select('assigned_ba_id')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabase
      .from('customer_requests')
      .delete()
      .eq('id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    if (existing?.assigned_ba_id) {
      await commitAssignment(supabase, {
        previousBaId: existing.assigned_ba_id,
        nextBaId: null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
