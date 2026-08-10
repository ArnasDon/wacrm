import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * PATCH /api/ai/flywheel/[id] — apply or dismiss a drafted suggestion
 * (admin+). Applying a lesson only flips its status; the content is folded
 * into the auto-reply prompt at generation time (see retrieveAppliedLessons),
 * so dismissing/un-applying later is always safe and reversible.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const body = await request.json().catch(() => null)
    const action = body?.action

    if (action !== 'apply' && action !== 'dismiss') {
      return NextResponse.json({ error: 'action must be "apply" or "dismiss"' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const update =
      action === 'apply'
        ? { status: 'applied', applied_at: now, dismissed_at: null }
        : { status: 'dismissed', dismissed_at: now, applied_at: null }

    const { data, error } = await supabase
      .from('agent_suggestions')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, status')
      .maybeSingle()
    if (error) {
      console.error('[ai/flywheel PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update suggestion' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, ...data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
