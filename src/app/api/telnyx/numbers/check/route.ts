import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import {
  createTelnyxClient,
  loadTelnyxApiKey,
  TelnyxApiError,
  type NumberLookupResult,
  type ReputationResult,
} from '@/lib/telnyx/api'

// ============================================================
// POST /api/telnyx/numbers/check — valida un número E.164 y consulta
// su carrier/line_type contra Telnyx number_lookup + reputación
// (spam_risk/scores). agent+.
//
// Endpoints verificados en context7 (developers.telnyx.com):
//   - GET /v2/number_lookup/{number}          → { data: { carrier, line_type } }
//   - GET /v2/reputation/phone_numbers/{number} → { data: { reputation_data } }
//     (el '+' del E.164 va URL-encoded como %2B en el path)
//
// Score de reputación (0-100): compuesto defensivo. Si Telnyx devuelve
// reputation_data, se promedian los scores reales; spam_risk 'high' fuerza
// score bajo. DAD §3: score < 60 → bloqueo de compra. Sin datos de
// reputación → score null (no bloquea; falta monitoreo en Telnyx).
// ============================================================

/** Devuelve el nombre del carrier como string (el shape puede ser objeto). */
function carrierName(carrier: NumberLookupResult['carrier']): string | null {
  if (typeof carrier === 'string') return carrier
  if (carrier && typeof carrier === 'object' && typeof carrier.name === 'string') {
    return carrier.name
  }
  return null
}

/** Score 0-100 defensivo desde reputation_data + spam_risk. */
function reputationScore(r: ReputationResult | null): number | null {
  if (!r) return null
  if (r.spam_risk === 'high') return 20
  const scores = [r.maturity_score, r.connection_score, r.engagement_score].filter(
    (s): s is number => typeof s === 'number',
  )
  if (scores.length === 0) return null
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')

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

    // --- Fase 1 (antes era un stub con score: 100 fijo) ---
    const apiKey = await loadTelnyxApiKey(ctx.accountId)
    const client = createTelnyxClient(apiKey)
    const e164 = `+${normalizePhone(number)}`

    const [lookup, reputation] = await Promise.all([
      client.lookupNumber(e164).catch((err: TelnyxApiError) => {
        // Lookup 4xx (número no rutiable) → null; el check no debe romper.
        if (err.status && err.status >= 400 && err.status < 500) return null
        throw err
      }),
      client.getReputation(e164).catch((err: TelnyxApiError) => {
        // Reputación sin monitoreo → null; el check no debe romper.
        if (err.status && err.status >= 400 && err.status < 500) return null
        throw err
      }),
    ])

    const score = reputationScore(reputation)
    const blocked = score !== null && score < 60

    return NextResponse.json({
      number: e164,
      carrier: lookup ? carrierName(lookup.carrier) : null,
      line_type: lookup?.line_type ?? null,
      score,
      spam_risk: reputation?.spam_risk ?? null,
      blocked,
      note: blocked
        ? 'reputación baja — compra bloqueada (score < 60)'
        : score === null
          ? 'sin datos de reputación — compra permitida, verificar monitoreo'
          : undefined,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
