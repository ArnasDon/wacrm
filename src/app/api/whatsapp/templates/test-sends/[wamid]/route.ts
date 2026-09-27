import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'

/**
 * GET /api/whatsapp/templates/test-sends/:wamid
 *
 * The status webhooks Meta has posted so far for one template test send
 * (migration 048) — polled by the test window while it waits for
 * "Meta's Response". Scoped to the caller's account.
 */
export async function GET(_request: Request, context: { params: Promise<{ wamid: string }> }) {
  try {
    const { wamid } = await context.params
    const { accountId } = await requireRole('viewer')

    const { data, error } = await supabaseAdmin()
      .from('template_test_sends')
      .select('wamid, statuses, last_status, created_at')
      .eq('account_id', accountId)
      .eq('wamid', decodeURIComponent(wamid))
      .maybeSingle()

    if (error) {
      console.error('[template-test] status lookup failed:', error.message)
      return NextResponse.json({ error: 'Could not load the test send.' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Test send not found.' }, { status: 404 })
    }
    return NextResponse.json({
      wamid: data.wamid,
      statuses: data.statuses ?? [],
      last_status: data.last_status,
      sent_at: data.created_at,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
