import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { dispatchConversationAssignedAutomations } from '@/lib/automations/dispatch-conversation-assigned'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/conversations/[id]/assign  (agent+)
 *
 * Update `assigned_agent_id` and fire `conversation_assigned` automations.
 * Centralizes assignment so the automation engine sees every inbox assign.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id: conversationId } = await params

    const body = await request.json().catch(() => null)
    if (!body || !('assigned_agent_id' in body)) {
      return NextResponse.json(
        { error: 'assigned_agent_id is required (use null to unassign)' },
        { status: 400 },
      )
    }

    const assignedAgentId =
      body.assigned_agent_id === null || body.assigned_agent_id === ''
        ? null
        : String(body.assigned_agent_id)

    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id, assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (convErr) {
      console.error('[conversations/assign] lookup failed:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (assignedAgentId === conv.assigned_agent_id) {
      return NextResponse.json({ ok: true, assigned_agent_id: assignedAgentId })
    }

    const { error: updErr } = await supabase
      .from('conversations')
      .update({ assigned_agent_id: assignedAgentId, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('account_id', accountId)

    if (updErr) {
      console.error('[conversations/assign] update failed:', updErr)
      return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 })
    }

    if (assignedAgentId) {
      await dispatchConversationAssignedAutomations({
        accountId,
        conversationId,
        contactId: (conv.contact_id as string | null) ?? null,
        agentId: assignedAgentId,
      })
    }

    return NextResponse.json({ ok: true, assigned_agent_id: assignedAgentId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
