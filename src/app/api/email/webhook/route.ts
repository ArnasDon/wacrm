import { NextResponse, type NextRequest } from 'next/server'
import { EmailError, verifyResendWebhook } from '@/lib/email/send'
import { supabaseAdmin } from '@/lib/telnyx/admin-client'

// ============================================================
// POST /api/email/webhook — webhook de Resend (Item 14, DAD §7.7).
//
// Fail-closed: verifica la firma Svix con `resend.webhooks.verify`
// (API verificada en context7) antes de tocar nada. Sin el secret
// configurado el endpoint rechaza (503) para no provocar reinientos
// de Resend con datos que no podemos autenticar.
//
//   email.delivered → email_sends.status = 'delivered'
//   email.bounced   → email_sends.status = 'bounced'
//   email.opened    → opened_count += 1, opened_at (primera vez)
//   email.clicked   → clicked_count += 1, clicked_at (primera vez)
//
// La RPC `_on_email_webhook` (048) hace el UPDATE atómico por
// resend_message_id (payload `data.email_id`).
// ============================================================

interface ResendWebhookPayload {
  type?: string
  data?: { email_id?: string }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const raw = await req.text()

  let event: ResendWebhookPayload
  try {
    event = (await verifyResendWebhook(
      raw,
      {
        id: req.headers.get('svix-id'),
        timestamp: req.headers.get('svix-timestamp'),
        signature: req.headers.get('svix-signature'),
      },
      secret,
    )) as ResendWebhookPayload
  } catch (err) {
    const message = err instanceof EmailError ? err.message : 'invalid signature'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const type = event.type ?? 'unknown'
  const emailId = event.data?.email_id ?? null

  if (emailId) {
    const trigger =
      type === 'email.delivered' ? 'delivered'
      : type === 'email.bounced' ? 'bounced'
      : type === 'email.opened' ? 'opened'
      : type === 'email.clicked' ? 'clicked'
      : null

    if (trigger) {
      // Fail-open en el UPDATE: si el email_sends ya no existe (purga u otro
      // account) no rompemos el ack de Resend. El error se loguea.
      const { error } = await supabaseAdmin().rpc('_on_email_webhook', {
        p_resend_message_id: emailId,
        p_trigger: trigger,
      })
      if (error) {
        console.error(`[email:webhook] update failed for ${type}: ${error.message}`)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
