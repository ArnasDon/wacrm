import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const STATUSES = ['draft', 'pending_review', 'approved', 'rejected'] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; claimId: string }> }
) {
  try {
    const { supabase, userId } = await requireRole('admin');
    const { id, claimId } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const update: Record<string, unknown> = {};
    if (typeof body.claim_text === 'string') {
      const text = body.claim_text.trim();
      if (!text)
        return NextResponse.json(
          { error: 'claim_text cannot be empty' },
          { status: 400 }
        );
      update.claim_text = text;
    }
    if (typeof body.status === 'string') {
      if (!(STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json(
          { error: `status must be one of: ${STATUSES.join(', ')}` },
          { status: 400 }
        );
      }
      update.status = body.status;
      // approved_by/approved_at track the CURRENT approval, not history —
      // moving away from 'approved' (e.g. back to draft, or rejected)
      // clears them rather than leaving a stale "approved by X" on a
      // claim that isn't approved anymore.
      if (body.status === 'approved') {
        update.approved_by = userId;
        update.approved_at = new Date().toISOString();
      } else {
        update.approved_by = null;
        update.approved_at = null;
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('product_claims')
      .update(update)
      .eq('id', claimId)
      .eq('product_id', id)
      .select()
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    return NextResponse.json({ claim: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; claimId: string }> }
) {
  try {
    const { supabase } = await requireRole('admin');
    const { id, claimId } = await params;
    const { error } = await supabase
      .from('product_claims')
      .delete()
      .eq('id', claimId)
      .eq('product_id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
