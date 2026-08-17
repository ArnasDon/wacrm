// ============================================================
// POST /api/public/account-request
//
// Public — no auth required. Replaces open self-signup as the public
// entry point: a prospective customer fills out this form instead of
// creating a working account directly. We just email the request to
// Angel (same inbox "Reportar pago" / "Reportar error" already use —
// see src/app/api/billing/report-payment and src/app/api/support/report)
// so he can call them and close the deal himself; no account, invitation,
// or database row gets created here. Deliberately minimal — no request
// history table, since nothing downstream reads one yet.
// ============================================================

import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendEmail, EmailError } from '@/lib/email/send'

const REQUESTS_INBOX = 'asistentedechat@gmail.com'

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

interface RequestBody {
  company_name?: string
  requester_name?: string
  daily_inquiries?: string
  phone?: string
  email?: string
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const limit = checkRateLimit(`account-request:${ip}`, RATE_LIMITS.accountRequest)
  if (!limit.success) return rateLimitResponse(limit)

  const body = (await request.json().catch(() => null)) as RequestBody | null
  const companyName = body?.company_name?.trim() ?? ''
  const requesterName = body?.requester_name?.trim() ?? ''
  const dailyInquiries = body?.daily_inquiries?.trim() ?? ''
  const phone = body?.phone?.trim() ?? ''
  const email = body?.email?.trim() ?? ''

  if (!companyName || !requesterName || !dailyInquiries || !phone || !email) {
    return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 })
  }

  const text = [
    'Nueva solicitud de cuenta — Chat Sandía',
    '',
    `Empresa: ${companyName}`,
    `Solicitante: ${requesterName}`,
    `Consultas estimadas por día: ${dailyInquiries}`,
    `Teléfono: ${phone}`,
    `Correo: ${email}`,
  ].join('\n')

  try {
    await sendEmail({
      account: 'support',
      to: REQUESTS_INBOX,
      subject: `Solicitud de cuenta — ${companyName}`,
      text,
    })
  } catch (err) {
    if (err instanceof EmailError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[public/account-request] error:', err)
    return NextResponse.json({ error: 'No se pudo enviar la solicitud' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
