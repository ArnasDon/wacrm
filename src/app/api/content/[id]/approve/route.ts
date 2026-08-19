import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// POST /api/content/[id]/approve — In Review -> Approved or, on
// rejection, back to Draft (admin+ only — approval is an admin
// action per §11/§14, not something a BA who submitted their own
// draft can rubber-stamp).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId } = await requireRole('admin');
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const approve = body?.approve !== false; // default true

    const { data, error } = await supabase
      .from('content')
      .update(
        approve
          ? {
              status: 'Approved',
              approved_by: userId,
              approved_at: new Date().toISOString(),
            }
          : { status: 'Draft', approved_by: null, approved_at: null }
      )
      .eq('id', id)
      .eq('status', 'In Review')
      .select()
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) {
      return NextResponse.json(
        { error: 'Content not found, or not in In Review status' },
        { status: 409 }
      );
    }
    return NextResponse.json({ content: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
