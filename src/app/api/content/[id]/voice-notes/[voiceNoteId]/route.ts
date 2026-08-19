import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; voiceNoteId: string }> }
) {
  try {
    const { supabase } = await requireRole('agent');
    const { id, voiceNoteId } = await params;
    // Storage object cleanup is intentionally not attempted here — the
    // row is the source of truth for what's "attached"; an orphaned
    // object in the bucket is a storage nit (matches the documented
    // trade-off on deleteAccountMedia), not something worth risking a
    // partial failure (row deleted, storage delete throws) over.
    const { error } = await supabase
      .from('voice_notes')
      .delete()
      .eq('id', voiceNoteId)
      .eq('content_id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
