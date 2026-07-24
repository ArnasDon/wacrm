// ============================================================
// /api/ads/accounts/[id]
//
//   DELETE — disconnect an ad platform (admin+). Cascades to its
//            campaigns / metrics / ad_entities (all FK ON DELETE
//            CASCADE from ad_account_id) — deliberately: the point of
//            disconnecting is to remove the connection and stop the
//            sync from touching this account's data again, not to
//            keep orphaned rows around.
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
      .from('ad_accounts')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)

    if (error) {
      console.error('[DELETE /api/ads/accounts/[id]] delete error:', error)
      return NextResponse.json({ error: 'Failed to disconnect ad account' }, { status: 500 })
    }
    if (!count) {
      return NextResponse.json({ error: 'Ad account not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
