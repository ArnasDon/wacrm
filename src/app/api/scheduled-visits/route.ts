import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/scheduled-visits
 *
 * Every store visit the agent (or a teammate) has booked for this
 * account, newest-scheduled-first for upcoming ones. Any account member
 * can view — the same audience as the inbox they came from.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('scheduled_visits')
      .select(
        'id, scheduled_at, notes, status, created_at, contact:contacts(id, name, phone)',
      )
      .eq('account_id', accountId)
      .order('scheduled_at', { ascending: true })
      .limit(200)
    if (error) {
      console.error('[scheduled-visits GET] error:', error)
      return NextResponse.json({ error: 'Failed to load scheduled visits' }, { status: 500 })
    }
    return NextResponse.json({ visits: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
