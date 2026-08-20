import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const application =
      typeof body.application === 'string' ? body.application.trim() : '';
    if (!application) {
      return NextResponse.json(
        { error: 'application is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('product_applications')
      .insert({
        account_id: accountId,
        product_id: id,
        application,
        notes:
          typeof body.notes === 'string' ? body.notes.trim() || null : null,
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
    return NextResponse.json({ application: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
