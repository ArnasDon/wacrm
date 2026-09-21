import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { listWonOpportunitiesSince } from '@/lib/crm/twenty-client'
import { handleOpportunityWon } from '@/lib/crm/twenty-purchase'
import { getCronHeartbeat, recordCronHeartbeat } from '@/lib/eter/repo/cron-heartbeats.repo'
import { checkCronStaleness } from '@/lib/eter/cron-liveness'

// ============================================================
// Bloco 5: fallback do webhook do Twenty (src/app/api/crm/twenty/webhook/
// route.ts) — corre de 15 em 15 min, lista negócios na fase `CLIENTE`
// actualizados nas últimas 24h e reprocessa os que faltam. Como
// handleOpportunityWon reserva o `event_id` (`${opportunityId}:Purchase`)
// de forma atómica em meta_capi_events, correr este cron a par de um
// webhook eventualmente activo nunca duplica o envio — o segundo dos
// dois a chegar perde a reserva e desiste.
//
// Mesmo padrão de auth de todo o cron interno: `x-cron-secret` contra
// `AUTOMATION_CRON_SECRET`.
// ============================================================

const CRON_NAME = 'crm-twenty-purchases-reconcile'
const STALE_THRESHOLD_MS = 45 * 60 * 1000
const LOOKBACK_HOURS = 24

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const previousHeartbeat = await getCronHeartbeat(admin, CRON_NAME).catch((err) => {
    console.error('[crm-twenty-purchases-cron] failed to read previous heartbeat:', err)
    return null
  })
  await checkCronStaleness({ cronName: CRON_NAME, thresholdMs: STALE_THRESHOLD_MS, previousHeartbeat })

  const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()

  let processed = 0
  let sent = 0
  let skipped = 0
  let errors = 0

  try {
    const won = await listWonOpportunitiesSince(sinceIso)
    for (const opp of won) {
      processed++
      try {
        const result = await handleOpportunityWon({
          db: admin,
          opportunityId: opp.id,
          stage: 'CLIENTE',
          amountMicros: opp.amountMicros,
          currencyCode: opp.currencyCode,
          pointOfContactId: opp.pointOfContactId,
        })
        if (result.outcome === 'sent') sent++
        else skipped++
      } catch (err) {
        errors++
        console.error(`[crm-twenty-purchases-cron] falha a processar opportunity ${opp.id}:`, err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    errors++
    console.error('[crm-twenty-purchases-cron] falha a listar negócios ganhos no Twenty:', err instanceof Error ? err.message : err)
  }

  const result = { processed, sent, skipped, errors, sinceIso }
  await recordCronHeartbeat(admin, CRON_NAME, result).catch((err) =>
    console.error('[crm-twenty-purchases-cron] failed to record heartbeat:', err),
  )

  return NextResponse.json({ ...result, staleThresholdMs: STALE_THRESHOLD_MS })
}
