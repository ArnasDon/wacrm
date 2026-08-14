import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadTimeInStage } from '@/lib/reporting/queries'

// ============================================================
// GET /api/report/time-in-stage
//
// Deals ACTIVOS por etapa y cuánto llevan en ella (mediana + máximo).
// Sin parámetros: es un corte "ahora mismo", no una serie por rango —
// la vista 063 deriva stage_entered_at de tracking_events y el tiempo
// se calcula contra now().
//
// Solo agent+ (requireRole), igual que el resto de /reports.
// ============================================================

export async function GET() {
  try {
    const ctx = await requireRole('agent')
    const rows = await loadTimeInStage(ctx.accountId)
    return NextResponse.json({ rows })
  } catch (err) {
    return toErrorResponse(err)
  }
}