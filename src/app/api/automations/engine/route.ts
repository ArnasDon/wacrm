import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ehGatilhoDaRegua } from '@/lib/asaas/regua'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import type { AutomationTriggerType } from '@/types'

/**
 * Manual trigger for testing or for external integrations that want
 * to fire automations. Auth is required — we resolve the caller's
 * account_id and dispatch over the account's automations.
 */
export async function POST(request: Request) {
  // Firing automations sends outbound WhatsApp — a write action. Require
  // at least `agent`; a viewer must not be able to trigger sends.
  let accountId: string
  try {
    // Fase 2 dos perfis (2026-08-30): mutação de automação/fluxo/disparo subiu de
    // 'agent' para 'admin' — decisão do operador; ver canManageAutomations em roles.ts.
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body?.trigger_type) {
    return NextResponse.json({ error: 'trigger_type required' }, { status: 400 })
  }
  // A régua do Asaas (998) só roda pela varredura: por aqui sairia sem
  // reconfirmar o pagamento, sem trava e com as `{{vars.*}}` vazias.
  if (ehGatilhoDaRegua(body.trigger_type)) {
    return NextResponse.json({ error: 'the Asaas collection sequence only runs from the Asaas sweep' }, { status: 400 })
  }

  await runAutomationsForTrigger({
    accountId,
    triggerType: body.trigger_type as AutomationTriggerType,
    contactId: body.contact_id ?? null,
    context: body.context ?? {},
  })

  return NextResponse.json({ ok: true })
}
