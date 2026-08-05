import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

// ============================================================
// POST /api/telnyx/numbers/buy — compra de números.
//
// Fase 1: la compra se hace desde el DASHBOARD de Telnyx (el número es
// la fuente de verdad; la UI de settings lee GET /v2/phone_numbers). El
// wiring de POST /v2/number_orders + reputación requiere verificar el
// shape de la API antes de automatizarlo — devolvemos 501 explícito
// para que la UI no finja compra. (owner)
// ============================================================

export async function POST(_req: NextRequest) {
  try {
    await requireRole('owner')
    return NextResponse.json(
      { error: 'number purchase is done from the Telnyx dashboard in Fase 1' },
      { status: 501 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}