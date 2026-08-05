import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { createTelnyxClient, loadTelnyxDialConfig } from '@/lib/telnyx/api'

// ============================================================
// POST /api/telnyx/call — marca al contacto (llamada saliente).
// agent+. Valida que el contacto pertenezca al account (404 si no),
// hace POST /v2/calls con la Call Control App + webhook, e inserta la
// fila outbound en `calls` VÍA ctx.supabase (cliente-user) para que la
// policy `calls_insert` (agent+) refuerce el rol en RLS (decisión §3.1).
// Fase 1: inbound = forwarding nativo Telnyx (sin bridge por código).
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')

    let body: { contactId?: string }
    try {
      body = (await req.json()) as { contactId?: string }
    } catch {
      return NextResponse.json({ error: 'bad body' }, { status: 400 })
    }
    if (!body.contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
    }

    const contact = await ctx.supabase
      .from('contacts')
      .select('id, phone')
      .eq('id', body.contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!contact.data) {
      return NextResponse.json({ error: 'contact not found' }, { status: 404 })
    }

    const to = `+${normalizePhone(contact.data.phone ?? '')}`
    if (!isValidE164(to)) {
      return NextResponse.json({ error: 'contact has no valid phone' }, { status: 400 })
    }

    const cfg = await loadTelnyxDialConfig(ctx.accountId)
    if (!cfg.connectionId) {
      return NextResponse.json(
        { error: 'Telnyx Call Control App not configured' },
        { status: 400 },
      )
    }

    const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000'
    const dialed = await createTelnyxClient(cfg.apiKey).dial({
      to,
      from: cfg.fromNumber,
      connectionId: cfg.connectionId,
      webhookUrl: `${base}/api/telnyx/webhook`,
    })

    const { error } = await ctx.supabase.from('calls').insert({
      account_id: ctx.accountId,
      contact_id: contact.data.id,
      direction: 'outbound',
      status: 'initiated',
      from_number: cfg.fromNumber,
      to_number: to,
      telnyx_call_control_id: dialed.callControlId,
      telnyx_call_leg_id: dialed.callLegId,
      telnyx_call_session_id: dialed.callSessionId,
    })
    if (error) {
      return NextResponse.json({ error: 'could not log call' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, callControlId: dialed.callControlId })
  } catch (err) {
    return toErrorResponse(err)
  }
}