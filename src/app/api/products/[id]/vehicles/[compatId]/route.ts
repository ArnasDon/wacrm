import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; compatId: string }> }
) {
  try {
    const { supabase } = await requireRole('admin');
    const { id, compatId } = await params;
    const { error } = await supabase
      .from('product_vehicles')
      .delete()
      .eq('id', compatId)
      .eq('product_id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
