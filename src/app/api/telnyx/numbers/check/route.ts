import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { createTelnyxClient, loadTelnyxApiKey } from '@/lib/telnyx/api'

// ============================================================
// POST /api/telnyx/numbers/check — valida un número E.164 y consulta
// su carrier/line_type contra Telnyx number_lookup (defensivo).
// agent+.
//
// NOTA (Fase 1): el bloqueo por spam/reputación (score < 60) depende
// del endpoint de reputación de Telnyx, cuyo shape de respuesta no está
// verificado aún; se devuelve `score: 100` como default y el bloqueo de
// compra queda sin conectar hasta validar la API (§9 plan).
// ============================================================

export async function POST(req: NextRequest) {
  try {
    await requireRole('agent')

    const body = (await req.json()) as { number?: string }
    const number = typeof body.number === 'string' ? body.number.trim() : ''
    if (!number) {
      return NextResponse.json({ error: 'number is required' }, { status: 400 })
    }
    if (!isValidE164(number)) {
      return NextResponse.json(
        { error: 'number must be a valid E.164 phone number' },
        { status: 400 },
      )
    }

    return NextResponse.json({
      number: `+${normalizePhone(number)}`,
      carrier: null,
      line_type: null,
      score: 100,
      note: 'carrier lookup + spam reputación aguardan verificar la API Telnyx (Fase 1)',
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}