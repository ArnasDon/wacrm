import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  try {
    const { supabase } = await requireRole('admin');
    const { id, imageId } = await params;
    // Storage object cleanup intentionally not attempted here — same
    // documented trade-off as content's voice-note delete (the row is
    // the source of truth for what's attached; an orphaned bucket
    // object is a storage nit, not worth a partial-failure risk).
    const { error } = await supabase
      .from('product_images')
      .delete()
      .eq('id', imageId)
      .eq('product_id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
