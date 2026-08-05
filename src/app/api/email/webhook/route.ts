import { NextResponse, type NextRequest } from 'next/server'

// ============================================================
// POST /api/email/webhook — webhook de Resend (opcional v1).
//
// v1: solo ack + log. La verificación de firma Svix
// (`resend.webhooks.verify`, headers svix-id/timestamp/signature) y la
// actualización de estado en `email.delivered` / `email.bounced` quedan
// para v2 — el flujo transaccional (send_email) no depende de ellos.
// Devuelve 200 siempre para no provocar reintentos de Resend.
// ============================================================

export async function POST(req: NextRequest) {
  const raw = await req.text()
  let event: unknown = null
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'bad body' }, { status: 400 })
  }
  const type = (event as { type?: string })?.type ?? 'unknown'
  console.log(`[email:webhook] event=${type}`)
  return NextResponse.json({ ok: true })
}