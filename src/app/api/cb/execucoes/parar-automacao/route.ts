// ============================================================
// POST /api/cb/execucoes/parar-automacao — cancelar as esperas pendentes de
// UMA automação para UM contato, a pedido de gente (botão da aba).
//
// Espelha o passo `stop_automation` do motor (engine.ts), com as MESMAS
// cercas — automação + conta + contato + status='pending'. O recorte por
// contato não é detalhe: sem ele, parar o follow-up de um cliente apagaria
// as esperas de TODOS os clientes daquela automação, em silêncio.
//
// `cancelled`, nunca `failed`: cancelamento não é erro e não pode alimentar
// o painel de falhas (decisão da 936). O desfecho do log NÃO é tocado; desde
// a 1005 o registro ganha a MARCA `interrompida_em` (motivo `parar`), a mesma
// dos outros cancelamentos — é ela que a retomada e o estacionamento leem.
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { marcarExecucoesInterrompidas } from '@/lib/automations/interrupcao'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const limite = checkRateLimit(
      `cb:execucoes:${ctx.userId}`,
      RATE_LIMITS.execucao,
    )
    if (!limite.success) return rateLimitResponse(limite)

    const body = (await request.json().catch(() => null)) as {
      contact_id?: unknown
      automation_id?: unknown
    } | null

    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : ''
    const automationId =
      typeof body?.automation_id === 'string' ? body.automation_id : ''
    if (!UUID_RE.test(contactId) || !UUID_RE.test(automationId)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .eq('automation_id', automationId)
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .eq('status', 'pending')
      .select('id, log_id')

    if (error) {
      console.error('[execucoes] parar-automacao falhou:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    // A MARCA no registro (1005): é o que impede a continuação que ainda não
    // estava na fila — o escopo de fora rodando, a retentativa — de retomar a
    // execução que o operador acabou de parar.
    await marcarExecucoesInterrompidas(
      db,
      (data ?? []).map((l) => (l as { log_id: string | null }).log_id),
      'parar',
    )

    // 0 não é erro: a espera pode ter acordado (ou sido cancelada) entre a
    // carga da aba e o clique — a lista é uma foto de segundos atrás.
    return NextResponse.json({ ok: true, canceladas: (data ?? []).length })
  } catch (err) {
    return toErrorResponse(err)
  }
}
