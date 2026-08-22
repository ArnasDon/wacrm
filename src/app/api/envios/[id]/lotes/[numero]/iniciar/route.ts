import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isLoteBlocked } from '@/lib/envios/lote-engine'

/**
 * Starts a lote's send queue. Validates server-side (not just a
 * disabled button in the UI — spec section 3):
 *   - a lote stays blocked until every lower-numbered lote (of the
 *     same Envio) is `concluido` — generalized to N lotes, see
 *     `isLoteBlocked`.
 *   - no other lote is already `em_andamento` in this account (also
 *     enforced at the DB level by the `check_single_active_lote`
 *     trigger — migration 078 — this check just returns a readable
 *     409 instead of letting that trigger's RAISE EXCEPTION surface).
 *
 * The actual sending happens on GET /api/envios/cron — this endpoint
 * only flips the lote to `em_andamento` and schedules its first lead.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; numero: string }> },
) {
  try {
    const { supabase } = await requireRole('agent')
    const { id: envioId, numero } = await params
    const numeroLote = Number(numero)
    if (!Number.isInteger(numeroLote) || numeroLote < 1) {
      return NextResponse.json({ error: 'invalid lote number' }, { status: 400 })
    }

    const { data: lotes, error: lotesErr } = await supabase
      .from('envio_lotes')
      .select('id, numero_lote, status')
      .eq('envio_id', envioId)
    if (lotesErr) throw new Error(lotesErr.message)
    const lote = lotes?.find((l) => l.numero_lote === numeroLote)
    if (!lote) {
      return NextResponse.json({ error: 'lote not found' }, { status: 404 })
    }
    if (lote.status !== 'aguardando' && lote.status !== 'pausado') {
      return NextResponse.json(
        { error: `lote is already '${lote.status}'` },
        { status: 409 },
      )
    }

    if (isLoteBlocked(numeroLote, lotes ?? [])) {
      return NextResponse.json(
        { error: 'Libera ao concluir o lote anterior' },
        { status: 409 },
      )
    }

    const { data: activeElsewhere } = await supabase
      .from('envio_lotes')
      .select('id')
      .eq('status', 'em_andamento')
      .neq('id', lote.id)
      .limit(1)
    if (activeElsewhere && activeElsewhere.length > 0) {
      return NextResponse.json(
        { error: 'Já existe um lote em andamento nesta conta — só um envio ativo por vez' },
        { status: 409 },
      )
    }

    const { error: startErr } = await supabase
      .from('envio_lotes')
      .update({ status: 'em_andamento', iniciado_em: new Date().toISOString() })
      .eq('id', lote.id)
    if (startErr) throw new Error(startErr.message)

    // Schedule the first na_fila lead — everything after that is
    // chained by the cron tick (GET /api/envios/cron).
    const { data: firstLead } = await supabase
      .from('envio_leads')
      .select('id')
      .eq('lote_id', lote.id)
      .eq('status', 'na_fila')
      .is('next_attempt_at', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (firstLead) {
      await supabase
        .from('envio_leads')
        .update({ next_attempt_at: new Date().toISOString() })
        .eq('id', firstLead.id)
    }

    await supabase.from('envios').update({ status: 'em_andamento' }).eq('id', envioId).eq('status', 'rascunho')

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
