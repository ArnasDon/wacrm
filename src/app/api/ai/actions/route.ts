import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { BusinessActionError, confirmationPhrase, executeBusinessAction, type BusinessAction } from '@/lib/ai/business-actions'

const ACTIONS = new Set<BusinessAction>(['close_conversation', 'mark_deal_won', 'move_deal'])

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = await checkSharedRateLimit(`ai-action:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null)
    const action = body?.action as BusinessAction
    const targetId = typeof body?.targetId === 'string' ? body.targetId : ''
    if (!ACTIONS.has(action) || !targetId) return NextResponse.json({ error: 'Invalid action or targetId' }, { status: 400 })

    const expectedConfirmation = confirmationPhrase(action, targetId)
    if (body?.confirmation !== expectedConfirmation) {
      return NextResponse.json({
        requiresConfirmation: true, action, targetId,
        confirmation: expectedConfirmation,
        message: 'Review the proposed action and send the exact confirmation value to execute it.',
      }, { status: 409 })
    }

    const result = await executeBusinessAction({
      db: supabase, accountId, userId, action, targetId,
      stageId: typeof body?.stageId === 'string' ? body.stageId : undefined,
    })
    return NextResponse.json({ ok: true, action, result })
  } catch (error) {
    if (error instanceof BusinessActionError) return NextResponse.json({ error: error.message }, { status: error.status })
    return toErrorResponse(error)
  }
}
