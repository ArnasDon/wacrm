import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// POST /api/content/[id]/submit — Draft -> In Review (agent+).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('agent');
    const { id } = await params;

    const { data, error } = await supabase
      .from('content')
      .update({ status: 'In Review' })
      .eq('id', id)
      .eq('status', 'Draft')
      .select()
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) {
      return NextResponse.json(
        { error: 'Content not found, or not in Draft status' },
        { status: 409 }
      );
    }
    return NextResponse.json({ content: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
