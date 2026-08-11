import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { createTelnyxClient } from '@/lib/telnyx/api'

// ============================================================
// POST /api/telnyx/config — guarda config Telnyx (estándar "pegar 1
// API key y funciona"). owner-only. Valida la key contra GET
// /v2/phone_numbers antes de perseguir, encripta la key (AES-256-GCM)
// y la persiste en `telnyx_config` vía el cliente autenticado (RLS
// owner-only) — el patrón cliente-user, no service-role.
//
// La Call Control App / Messaging Profile se crean en el dashboard de
// Telnyx y se registran aquí por id; la creación vía API no se
// automatiza en Fase 1 (KISS, forwarding nativo).
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'bad body' }, { status: 400 })
    }

    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    if (!apiKey) {
      return NextResponse.json({ error: 'api_key is required' }, { status: 400 })
    }

    // Validar la key ANTES de guardar nada (mismo "guardar y verificar").
    try {
      await createTelnyxClient(apiKey).listPhoneNumbers()
    } catch {
      return NextResponse.json({ error: 'invalid Telnyx api key' }, { status: 400 })
    }

    const payload: Record<string, unknown> = {
      account_id: ctx.accountId,
      api_key_encrypted: encrypt(apiKey),
    }
    if (typeof body.default_from_number === 'string' && body.default_from_number.trim()) {
      payload.default_from_number = body.default_from_number.trim()
    }
    if (typeof body.call_control_app_id === 'string' && body.call_control_app_id.trim()) {
      payload.call_control_app_id = body.call_control_app_id.trim()
    }
    if (typeof body.messaging_profile_id === 'string' && body.messaging_profile_id.trim()) {
      payload.messaging_profile_id = body.messaging_profile_id.trim()
    }
    // Entrante (migración 057): conexión de credenciales + SIP del agente.
    if (
      typeof body.credential_connection_id === 'string' &&
      body.credential_connection_id.trim()
    ) {
      payload.credential_connection_id = body.credential_connection_id.trim()
    }
    if (typeof body.agent_sip_uri === 'string' && body.agent_sip_uri.trim()) {
      payload.agent_sip_uri = body.agent_sip_uri.trim()
    }

    const { error } = await ctx.supabase
      .from('telnyx_config')
      .upsert(payload, { onConflict: 'account_id' })

    if (error) {
      return NextResponse.json({ error: 'could not save telnyx config' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}