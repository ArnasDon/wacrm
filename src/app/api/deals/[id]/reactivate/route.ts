import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

// ============================================================
// POST /api/deals/[id]/reactivate — reactivación de un deal perdido
// (DAD §7.6 pestaña Perdidos, Item 15).
//
// Reabre el deal sobre la MISMA identidad: status→open, limpia lost_at,
// version++ (optimistic), y registra un evento `state_changed` con la
// razón para que el timeline conserve la historia (invariante 047: todo
// cambio de estado emite su fila). La atribución first-touch del
// contacto NO se toca (se conserva el canal/campaña originales).
// ============================================================

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params

    const admin = supabaseAdmin()
    const { data: deal, error: dealError } = await admin
      .from('deals')
      .select('id, account_id, status, version, stage_id, name')
      .eq('id', id)
      .maybeSingle()
    if (dealError || !deal) {
      return NextResponse.json({ error: 'deal not found' }, { status: 404 })
    }
    if (deal.account_id !== ctx.accountId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    if (deal.status !== 'lost') {
      return NextResponse.json({ error: 'deal is not lost' }, { status: 400 })
    }

    // Reabrir: status open, limpiar lost_at, version++ (reconcilia el
    // optimistic lock de la próxima transición). stage_id se conserva —
    // el SDR decide el stage en el kanban después.
    const { data: updated, error: updError } = await admin
      .from('deals')
      .update({ status: 'open', lost_at: null, version: (deal.version ?? 1) + 1 })
      .eq('id', id)
      .select('id, status, version, stage_id, account_id')
      .single()
    if (updError) {
      return NextResponse.json({ error: updError.message }, { status: 500 })
    }

    // Timeline: state_changed (invariante 047) — el payload no lleva
    // from_stage/to_stage porque el stage no cambia; registra la razón.
    await admin.from('tracking_events').insert({
      account_id: ctx.accountId,
      event_type: 'state_changed',
      payload: {
        deal_id: id,
        from_status: 'lost',
        to_status: 'open',
        triggered_by: 'agent',
        override_reason: 'reactivation from lost (Reports → Reactivate)',
      },
    })

    return NextResponse.json({ ok: true, deal: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
