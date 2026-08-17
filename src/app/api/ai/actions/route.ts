import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { BusinessActionError, confirmationPhrase, executeBusinessAction, type BusinessAction } from '@/lib/ai/business-actions'
import type { QuoteItemInput } from '@/lib/quotes/create-quote'

const ACTIONS = new Set<BusinessAction>([
  'close_conversation',
  'mark_deal_won',
  'move_deal',
  'set_lead_temperature',
  'create_quote',
  'schedule_appointment',
])

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
      temperature: typeof body?.temperature === 'string' ? body.temperature : undefined,
      items: Array.isArray(body?.items) ? (body.items as QuoteItemInput[]) : undefined,
      customerNit: typeof body?.customerNit === 'string' ? body.customerNit : undefined,
      customerEmail: typeof body?.customerEmail === 'string' ? body.customerEmail : undefined,
      customerPhone: typeof body?.customerPhone === 'string' ? body.customerPhone : undefined,
      customerAddress: typeof body?.customerAddress === 'string' ? body.customerAddress : undefined,
      startTime: typeof body?.startTime === 'string' ? body.startTime : undefined,
      endTime: typeof body?.endTime === 'string' ? body.endTime : undefined,
      attendeeEmail: typeof body?.attendeeEmail === 'string' ? body.attendeeEmail : undefined,
      appointmentSummary: typeof body?.appointmentSummary === 'string' ? body.appointmentSummary : undefined,
      appointmentDescription: typeof body?.appointmentDescription === 'string' ? body.appointmentDescription : undefined,
    })
    return NextResponse.json({ ok: true, action, result })
  } catch (error) {
    if (error instanceof BusinessActionError) return NextResponse.json({ error: error.message }, { status: error.status })
    return toErrorResponse(error)
  }
}
