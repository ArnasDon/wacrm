import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'

const VALID_STATUSES = new Set(['open', 'pending', 'closed'])

/**
 * PATCH /api/conversations/[id]/status
 *
 * Sets a conversation's status — the server-side counterpart to the
 * inbox status dropdown (`handleStatusChange` in
 * src/components/inbox/message-thread.tsx), which used to write
 * directly to Supabase from the browser. Moved server-side so a human
 * closing a conversation fires `conversation.closed`, matching the AI
 * action and the automations engine's own close step, which already
 * run server-side.
 *
 * Body: { status: 'open' | 'pending' | 'closed' }
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const status = typeof body?.status === 'string' ? body.status : ''
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: "status must be one of 'open', 'pending', 'closed'" },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('conversations')
      .update({ status })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, status')
      .maybeSingle()

    if (error) {
      console.error('Error updating conversation status:', error)
      return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (status === 'closed') {
      void dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.closed', {
        conversation_id: data.id,
        closed_by: 'human',
      })
    }

    return NextResponse.json({ success: true, conversation: data })
  } catch (error) {
    console.error('Error in conversations/[id]/status PATCH:', error)
    return toErrorResponse(error)
  }
}
