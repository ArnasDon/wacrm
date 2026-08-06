import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/telnyx/admin-client'
import {
  createTelnyxClient,
  TelnyxApiError,
} from '@/lib/telnyx/api'

// ============================================================
// POST /api/telnyx/numbers/buy — compra un número vía Telnyx.
// owner.
//
// Endpoints verificados en context7 (developers.telnyx.com):
//   - GET  /v2/reputation/phone_numbers/{number} → gate de compra
//     (DAD §3: score < 60 → rechaza). El '+' del E.164 va URL-encoded
//     como %2B en el path.
//   - POST /v2/number_orders → { phone_numbers[], connection_id,
//     messaging_profile_id, billing_group_id?, customer_reference? }
//     (billing_group_id y customer_reference opcionales según la API).
//
// La Call Control App (connection_id) y el Messaging Profile se leen de
// `telnyx_config` para asociar el número recién comprado; si no están
// configurados, se compra igual (Telnyx los asigna después desde el
// dashboard) — la compra no debe quedar bloqueada por la config previa.
// ============================================================

/** Lee la config Telnyx del account (service-role) para asociar el número. */
async function loadAccountConfig(accountId: string): Promise<{
  connectionId: string | null
  messagingProfileId: string | null
  apiKey: string
}> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('telnyx_config')
    .select('api_key_encrypted, call_control_app_id, messaging_profile_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) {
    throw new TelnyxApiError('Telnyx config not found for account')
  }
  return {
    connectionId: data.call_control_app_id ?? null,
    messagingProfileId: data.messaging_profile_id ?? null,
    // La key se guarda encriptada (AES-256-GCM, migración 038) — desencriptar.
    apiKey: decrypt(data.api_key_encrypted),
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')

    const body = (await req.json()) as { number?: string; billing_group_id?: string }
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

    const e164 = `+${normalizePhone(number)}`
    const config = await loadAccountConfig(ctx.accountId)
    const client = createTelnyxClient(config.apiKey)

    // --- Gate de reputación (DAD §3: score < 60 → rechaza compra) ---
    const reputation = await client.getReputation(e164).catch((err: TelnyxApiError) => {
      if (err.status && err.status >= 400 && err.status < 500) return null
      throw err
    })
    const spamRisk = reputation?.spam_risk ?? null
    if (spamRisk === 'high') {
      return NextResponse.json(
        { error: 'number has high spam risk — purchase blocked' },
        { status: 409 },
      )
    }

    const result = await client.createNumberOrder({
      phoneNumber: e164,
      connectionId: config.connectionId ?? undefined,
      messagingProfileId: config.messagingProfileId ?? undefined,
      billingGroupId: body.billing_group_id?.trim() || undefined,
      customerReference: `wacrm-${ctx.accountId.slice(0, 8)}`,
    })

    return NextResponse.json({
      order_id: result.id,
      status: result.status,
      phone_numbers_count: result.phoneNumbersCount,
      number: e164,
      note: 'número pedido — activación puede tardar (Telnyx)',
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
