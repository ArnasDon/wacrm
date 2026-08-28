import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { moveDeal, findWonStageId, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'

/**
 * PATCH /api/deals/[id]/status
 *
 * The server-side counterpart to the "Marcar como ganada / perdida /
 * Reabrir" buttons in src/components/pipelines/deal-form.tsx
 * (`handleStatusChange`), which used to write `status` / `won_at`
 * straight to Supabase from the browser. Moved here so that flipping a
 * deal to "won" through that button fires the SAME `deal.won` (and,
 * when the pipeline has a "Venta cerrada" stage, `deal.stage_changed`)
 * webhook events the Kanban drag already does via
 * /api/deals/[id]/stage — those events are what feed automations and a
 * connected Google Sheet. `lost` / `open` have no webhook event, so
 * they're a plain status update.
 *
 * Body: { status: 'won' | 'lost' | 'open' }
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Same bar as moving a deal (see /stage): agent+ — a write on
    // operational data.
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const status = body?.status
    if (status !== 'won' && status !== 'lost' && status !== 'open') {
      return NextResponse.json(
        { error: "status must be one of 'won', 'lost', 'open'" },
        { status: 400 }
      )
    }

    // Confirm the deal is in this account and grab its pipeline so a
    // "won" can be routed to the pipeline's closed-won stage.
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, pipeline_id, status')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (dealError) throw dealError
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const webhookDb = supabaseAdmin()

    if (status === 'won') {
      // Prefer moving the deal onto a real "Venta cerrada" stage so
      // stage_id and status don't drift apart (mirrors moveDeal on the
      // drag path). Fall back to a bare status flip when the pipeline
      // has no stage flagged is_won.
      const wonStageId = await findWonStageId(supabase, accountId, deal.pipeline_id)
      if (wonStageId) {
        const moved = await moveDeal(supabase, accountId, id, wonStageId)
        void dispatchWebhookEvent(webhookDb, accountId, 'deal.stage_changed', {
          deal_id: moved.deal.id,
          pipeline_id: moved.deal.pipeline_id,
          stage_id: moved.deal.stage_id,
          source: 'human',
        })
        void dispatchWebhookEvent(webhookDb, accountId, 'deal.won', {
          deal_id: moved.deal.id,
          source: 'human',
        })
        return NextResponse.json({ success: true, deal: moved.deal })
      }

      const { data: updated, error } = await supabase
        .from('deals')
        .update({ status: 'won', won_at: new Date().toISOString() })
        .eq('id', id)
        .eq('account_id', accountId)
        .select('id, pipeline_id, stage_id, status')
        .maybeSingle()
      if (error) throw error
      if (!updated) {
        return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
      }
      void dispatchWebhookEvent(webhookDb, accountId, 'deal.won', {
        deal_id: updated.id,
        source: 'human',
      })
      return NextResponse.json({ success: true, deal: updated })
    }

    // 'lost' or 'open' — clear won_at, no webhook event exists for these.
    const { data: updated, error } = await supabase
      .from('deals')
      .update({ status, won_at: null })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, pipeline_id, stage_id, status')
      .maybeSingle()
    if (error) throw error
    if (!updated) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, deal: updated })
  } catch (error) {
    if (error instanceof MoveDealError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in deals/[id]/status PATCH:', error)
    return toErrorResponse(error)
  }
}
