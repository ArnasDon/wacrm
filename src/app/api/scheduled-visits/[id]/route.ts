import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const ALLOWED_STATUSES = ['completed', 'cancelled', 'no_show'] as const

/**
 * PATCH /api/scheduled-visits/[id] — mark a visit as completed, cancelled
 * or a no-show (agent+). Scheduling itself only ever happens through the
 * agent's schedule_visit tool; this is the team's side of managing it.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params
    const body = await request.json().catch(() => null)
    const status = body?.status

    if (!ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('scheduled_visits')
      .update({ status })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, status')
      .maybeSingle()
    if (error) {
      console.error('[scheduled-visits PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update visit' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, ...data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
