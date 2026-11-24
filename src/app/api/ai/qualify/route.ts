import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { qualifyLead } from '@/lib/ai/lead-qualify'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/ai/qualify — manually trigger lead qualification
 * for a conversation from the UI.
 *
 * Body: { conversation_id: string }
 * Returns: { score: 'hot' | 'warm' | 'cold' } | { error: string }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-qualify:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(`ai-qualify-account:${accountId}`, RATE_LIMITS.aiDraftAccount)
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const conversationId = body?.conversation_id

    if (!conversationId || typeof conversationId !== 'string') {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }

    // Verify conversation belongs to this account
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, account_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (convErr || !conv) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      )
    }

    const score = await qualifyLead({
      accountId,
      conversationId: conv.id,
    })

    if (!score) {
      return NextResponse.json(
        { error: 'Could not qualify this lead. Please ensure an AI key is configured and there are customer messages.' },
        { status: 422 },
      )
    }

    return NextResponse.json({ score })
  } catch (err) {
    return toErrorResponse(err)
  }
}
