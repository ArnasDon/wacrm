import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; language: string }> }
) {
  try {
    const { supabase } = await requireRole('agent');
    const { id, language } = await params;
    const { error } = await supabase
      .from('content_translations')
      .delete()
      .eq('content_id', id)
      .eq('language', language);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
