import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { moveDeal, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'

/**
 * PATCH /api/deals/[id]/stage
 *
 * Moves a deal to a different pipeline stage — the server-side
 * counterpart to the Kanban drag-and-drop in
 * src/app/(dashboard)/pipelines/page.tsx (`handleDealMoved`), which
 * used to write directly to Supabase from the browser. Moved
 * server-side so a human dragging a card fires the same
 * `deal.stage_changed` / `deal.won` webhook events the AI action
 * already does (src/lib/ai/business-actions.ts), via the shared
 * `moveDeal()` helper both now call.
 *
 * Body: { stage_id: string }
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Moving a deal is a write on operational data — `canSendMessages`
    // territory (agent+), same bar as sending a message or reacting.
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const stageId = typeof body?.stage_id === 'string' ? body.stage_id : ''
    if (!stageId) {
      return NextResponse.json({ error: 'stage_id is required' }, { status: 400 })
    }

    const moved = await moveDeal(supabase, accountId, id, stageId)

    const webhookDb = supabaseAdmin()
    void dispatchWebhookEvent(webhookDb, accountId, 'deal.stage_changed', {
      deal_id: moved.deal.id,
      pipeline_id: moved.deal.pipeline_id,
      stage_id: moved.deal.stage_id,
      source: 'human',
    })
    if (moved.isWonStage) {
      void dispatchWebhookEvent(webhookDb, accountId, 'deal.won', {
        deal_id: moved.deal.id,
        source: 'human',
      })
    }

    return NextResponse.json({ success: true, deal: moved.deal })
  } catch (error) {
    if (error instanceof MoveDealError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in deals/[id]/stage PATCH:', error)
    return toErrorResponse(error)
  }
}
