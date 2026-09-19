import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import {
  drenarEventosDeFunil,
  podarEventosAntigos,
} from '@/lib/automations/drain-events'
import {
  varrerLembretes,
  podarLembretesAntigos,
} from '@/lib/automations/varrer-lembretes'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fila de eventos de funil (933) — a REDE DE SEGURANÇA. O caminho normal é
  // o aviso imediato que quem moveu o card dispara; este ciclo pega o que não
  // chegou lá (aba fechada, rede caindo, SQL na mão). Vem primeiro e é
  // independente: uma falha aqui não pode impedir as esperas de resumirem.
  const funil = await drenarEventosDeFunil()
  const podados = await podarEventosAntigos()

  // Lembretes por data (935). Não passam pela fila do funil: aquela existe
  // porque o gatilho nasce de uma escrita feita no navegador; este nasce da
  // passagem do tempo, e o cron já é onde o tempo passa.
  const lembretes = await varrerLembretes()
  const lembretesPodados = await podarLembretesAntigos()

  const admin = supabaseAdmin()

  // ⚠️ SINAL DE VIDA DO LAÇO RÁPIDO (migration 937), e o LUGAR é load-bearing.
  //
  // Fica aqui, num call site só, ANTES dos três `return` abaixo. A tentação é
  // carimbar no fim, junto do resultado — mas o caminho comum sai pelo
  // `return` do meio ("não havia execução parada"), e o carimbo nunca
  // aconteceria. Seria o defeito exato que a 927 nasceu para consertar do
  // outro lado: um batimento que só bate quando há trabalho não distingue
  // "parado" de "sem serviço hoje".
  //
  // Também protege de quem vier depois: um `return` novo mais abaixo não tem
  // como pular um carimbo que já foi feito.
  //
  // Best-effort. Falhar aqui não pode derrubar o ciclo — o preço de um
  // batimento perdido é a tela adiantar um aviso, que é o lado seguro.
  const { error: batErr } = await admin
    .from('cb_agendador_batimento')
    .update({ ultimo_ciclo_automacoes: new Date().toISOString() })
    .eq('id', true)
  if (batErr) {
    console.error('[automations] batimento não gravou:', batErr.message)
  }

  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) {
    return NextResponse.json({ processed: 0, funil, podados, lembretes, lembretesPodados })
  }

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
      created_at: (row.created_at as string | null) ?? null,
    })
    processed++
  }

  return NextResponse.json({ processed, funil, podados, lembretes, lembretesPodados })
}
