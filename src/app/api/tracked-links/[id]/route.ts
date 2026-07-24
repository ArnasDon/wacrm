// ============================================================
// DELETE /api/tracked-links/[id] — admin+.
//
// Existing clicks already attributed under this slug stay attributed
// (attribution_events/contacts keep their stamped values — nothing
// references tracked_links.id after the fact); this only stops the
// URL from resolving to a new redirect going forward.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const { error, count } = await ctx.supabase
      .from('tracked_links')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)

    if (error) {
      console.error('[DELETE /api/tracked-links/[id]] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete tracked link' }, { status: 500 })
    }
    if (!count) {
      return NextResponse.json({ error: 'Tracked link not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
