import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * DELETE /api/ai/memory/[id]  (admin+)
 *
 * Removes one persisted contact memory — e.g. to correct something
 * mis-extracted, or to answer a deletion request. contact-memory.ts's
 * cron will simply re-derive a fresh summary next time the conversation
 * closes or goes inactive; this does not disable extraction.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('contact_memories')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
