import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Pauses a running lote at any time (spec section 3). Leads already
 * `enviado`/`falhou` stay as-is; remaining `na_fila` leads simply lose
 * their `next_attempt_at` so the cron tick stops picking them up —
 * nothing is lost, "Iniciar lote" resumes from where it left off.
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

    const { data: lote, error: loteErr } = await supabase
      .from('envio_lotes')
      .select('id, status')
      .eq('envio_id', envioId)
      .eq('numero_lote', numeroLote)
      .maybeSingle()
    if (loteErr) throw new Error(loteErr.message)
    if (!lote) {
      return NextResponse.json({ error: 'lote not found' }, { status: 404 })
    }
    if (lote.status !== 'em_andamento') {
      return NextResponse.json({ error: `lote is '${lote.status}', not em_andamento` }, { status: 409 })
    }

    const { error: pauseErr } = await supabase
      .from('envio_lotes')
      .update({ status: 'pausado' })
      .eq('id', lote.id)
    if (pauseErr) throw new Error(pauseErr.message)

    // Un-schedule remaining queue — the cron tick's WHERE clause only
    // ever matches leads with next_attempt_at set, so this alone stops
    // processing. `enviando` is deliberately left untouched: it means
    // a send is in flight for this lead right now (the claim window is
    // sub-second), and clobbering it here could race with the cron
    // tick writing its actual result a moment later.
    await supabase
      .from('envio_leads')
      .update({ next_attempt_at: null })
      .eq('lote_id', lote.id)
      .eq('status', 'na_fila')
      .not('next_attempt_at', 'is', null)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
