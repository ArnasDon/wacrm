import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createLead } from '@/lib/routing/create-lead';

// POST /api/customer-requests/[id]/convert — qualify a CustomerRequest
// into a Lead (§12: "once it's qualified it becomes (or attaches to)
// a Lead"). Requires the request to already be linked to a Member
// (`contact_id`) — `deals.contact_id` is NOT NULL (migration 001), so
// an anonymous enquiry must be matched to a Member first.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');
    const { id } = await params;

    const { data: cr, error: fetchErr } = await supabase
      .from('customer_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!cr)
      return NextResponse.json(
        { error: 'Customer request not found' },
        { status: 404 }
      );
    if (cr.deal_id) {
      return NextResponse.json(
        { error: 'This request has already been converted to a Lead' },
        { status: 400 }
      );
    }
    if (!cr.contact_id) {
      return NextResponse.json(
        {
          error:
            'This request has no linked Member — resolve a contact before converting',
        },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const title =
      typeof body?.title === 'string' && body.title.trim()
        ? body.title.trim()
        : `${cr.type.replaceAll('_', ' ')} — converted from request`;

    const lead = await createLead(supabase, {
      accountId,
      userId,
      contactId: cr.contact_id,
      title,
      source: 'customer_request',
      campaignId: cr.campaign_id,
      notes: cr.notes,
    });

    const { data: updated, error: updateErr } = await supabase
      .from('customer_requests')
      .update({ deal_id: lead.id, status: 'RESOLVED' })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json(
      { customer_request: updated, lead },
      { status: 201 }
    );
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
