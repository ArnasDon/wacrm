import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// POST /api/products/[id]/claims — add a claim (admin+). Unlike Content
// Studio's Draft->submit->approve flow, every write here is already
// admin-gated by RLS (migration 041 — product_claims is settings-
// class), so there's no separate "agent proposes, admin approves"
// step: an admin can create a claim already `approved` (self-attesting
// something they verified themselves) or `draft`/`pending_review` to
// track it before committing. §2: "only administrator-approved data
// may be shown as fact" — the product page (not built here, per this
// phase's "management UI and API" scope) is what must filter to
// status = 'approved' before rendering a claim.

const STATUSES = ['draft', 'pending_review', 'approved', 'rejected'] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId, accountId } = await requireRole('admin');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const claimText =
      typeof body.claim_text === 'string' ? body.claim_text.trim() : '';
    if (!claimText) {
      return NextResponse.json(
        { error: 'claim_text is required' },
        { status: 400 }
      );
    }

    const status =
      typeof body.status === 'string' &&
      (STATUSES as readonly string[]).includes(body.status)
        ? body.status
        : 'draft';

    const { data, error } = await supabase
      .from('product_claims')
      .insert({
        account_id: accountId,
        product_id: id,
        claim_text: claimText,
        status,
        created_by: userId,
        approved_by: status === 'approved' ? userId : null,
        approved_at: status === 'approved' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'Product not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ claim: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
