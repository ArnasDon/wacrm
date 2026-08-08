import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/autoreply/[conversationId]  (agent+)
 *
 * Controls the AI auto-reply bot for one inbox conversation.
 *
 * Body: {
 *   paused: boolean,
 *   assign_to_me?: boolean,
 *   reset_context?: boolean
 * }
 *
 * `reset_context: true` starts a fresh AI conversation without deleting the
 * WhatsApp audit trail. Old messages remain visible to human agents, but the
 * AI will only receive messages created after the reset timestamp. The reset
 * also clears handoff state, releases human assignment and restores the reply
 * budget so the next inbound message is treated as a new conversation.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const db = supabaseAdmin()

    const limit = checkRateLimit(`ai-takeover:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body.paused !== 'boolean') {
      return NextResponse.json(
        { error: 'paused (boolean) is required' },
        { status: 400 },
      )
    }
    const paused = body.paused as boolean
    const assignToMe = body.assign_to_me === true
    const resetContext = body.reset_context === true

    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/autoreply] conversation lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const update: Record<string, unknown> = { ai_autoreply_disabled: paused }

    if (resetContext) {
      update.ai_context_reset_at = new Date().toISOString()
      update.ai_autoreply_disabled = false
      update.assigned_agent_id = null
      update.ai_reply_count = 0
      update.ai_handoff_summary = null
    } else if (paused) {
      if (assignToMe) update.assigned_agent_id = userId
    } else {
      update.assigned_agent_id = null
      update.ai_reply_count = 0
      update.ai_handoff_summary = null
    }

    const { error: upErr } = await db
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[ai/autoreply] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to update conversation' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      paused: resetContext ? false : paused,
      context_reset: resetContext,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
