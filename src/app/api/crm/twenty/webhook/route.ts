import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { handleOpportunityWon } from '@/lib/crm/twenty-purchase'

// ============================================================
// Bloco 5: webhook do Twenty CRM para `opportunity` actualizada.
//
// ATENÇÃO — payload não confirmado: até à data desta implementação
// não foi possível confirmar por API se esta instância do Twenty
// suporta a criação de webhooks (não há `/rest/webhooks` documentado
// em /Users/ricardo/twenty-crm/API.md, e a skill `crm` regista
// explicitamente que "Workflows não são configuráveis por API com a
// chave actual — exigem sessão de utilizador autenticado"). O Twenty
// tem uma página de Settings > APIs & Webhooks na interface onde um
// webhook pode ser configurado manualmente; se o Ricardo o configurar
// por aí, o formato exacto do payload deve ser confirmado num teste
// real e este parser ajustado se necessário — ver `parseTwentyWebhookPayload`
// abaixo, escrito de forma tolerante a variações de shape razoáveis
// (evento standard de audit log do Twenty: `{ eventName, objectMetadata,
// record, updatedFields }`, ou um payload mais simples `{ object,
// action, record }`).
//
// Enquanto isso não está confirmado, o caminho garantido de detectar
// negócios ganhos é o cron de reconciliação em
// src/app/api/crm/twenty/purchases-cron/route.ts (fallback, corre de
// 15 em 15 min). Este endpoint fica pronto a receber o webhook assim
// que o Ricardo o configurar, sem exigir alterações de código.
//
// Autenticação: header `x-twenty-webhook-secret` comparado contra
// `TWENTY_WEBHOOK_SECRET` (comparação em tempo constante). Enquanto
// essa variável não estiver definida no ambiente, o endpoint aceita
// pedidos sem segredo (com aviso em log) — decisão deliberada para
// destravar o teste inicial; o Ricardo deve gerar e definir o valor
// assim que confirmar o formato do webhook (ver relatório da tarefa).
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.TWENTY_WEBHOOK_SECRET
  if (!expected) {
    console.warn('[crm twenty webhook] TWENTY_WEBHOOK_SECRET não definido — a aceitar pedidos sem validar segredo.')
    return true
  }
  const supplied = request.headers.get('x-twenty-webhook-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  return suppliedBuf.length === expectedBuf.length && timingSafeEqual(suppliedBuf, expectedBuf)
}

interface ParsedOpportunityUpdate {
  opportunityId: string
  stage: string | null
  amountMicros: number
  currencyCode: string
  pointOfContactId: string | null
}

/** Tolerante a duas formas plausíveis de payload — ver nota no topo
 *  do ficheiro sobre o formato não estar confirmado. Devolve `null`
 *  quando o payload não é sobre uma opportunity ou não tem id. */
function parseTwentyWebhookPayload(body: unknown): ParsedOpportunityUpdate | null {
  if (!body || typeof body !== 'object') return null
  const payload = body as Record<string, unknown>

  const objectName =
    (payload.objectMetadata as Record<string, unknown> | undefined)?.nameSingular ??
    payload.object ??
    payload.objectName
  if (objectName && objectName !== 'opportunity') return null

  const record = (payload.record ?? payload.data ?? payload) as Record<string, unknown>
  const id = record?.id
  if (typeof id !== 'string') return null

  const amount = record.amount as { amountMicros?: number; currencyCode?: string } | undefined
  const pointOfContactId =
    (record.pointOfContactId as string | undefined) ??
    (record.pointOfContact as { id?: string } | undefined)?.id ??
    null

  return {
    opportunityId: id,
    stage: typeof record.stage === 'string' ? record.stage : null,
    amountMicros: amount?.amountMicros ?? 0,
    currencyCode: amount?.currencyCode ?? 'EUR',
    pointOfContactId: pointOfContactId ?? null,
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = parseTwentyWebhookPayload(body)
  if (!parsed) {
    return NextResponse.json({ skipped: 'not_an_opportunity_update' }, { status: 200 })
  }

  const result = await handleOpportunityWon({
    db: supabaseAdmin(),
    opportunityId: parsed.opportunityId,
    stage: parsed.stage,
    amountMicros: parsed.amountMicros,
    currencyCode: parsed.currencyCode,
    pointOfContactId: parsed.pointOfContactId,
  })

  return NextResponse.json(result)
}
