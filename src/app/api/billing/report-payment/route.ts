import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendEmail, EmailError } from '@/lib/email/send'

const PAYMENTS_INBOX = 'pagosandia@gmail.com'

/**
 * POST /api/billing/report-payment  (admin+)
 *
 * "Reportar pago" — a company's admin/owner tells Angel they just
 * paid. Emails PAYMENTS_INBOX with the company, who reported it, when,
 * and the bank details on file (as a reference the report itself
 * carries, per the product decision that the email should be
 * self-contained) — Angel still has to manually "Marcar como pagada"
 * in /admin; this route never touches next_payment_due_at itself.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin')

    const limit = await checkSharedRateLimit(`payment-report:${ctx.userId}`, RATE_LIMITS.paymentReport)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: settings } = await ctx.supabase
      .from('platform_settings')
      .select('bank_name, account_number, account_type, account_holder')
      .eq('id', 1)
      .maybeSingle()

    const {
      data: { user },
    } = await ctx.supabase.auth.getUser()

    const bankLines = settings
      ? [
          `Banco: ${settings.bank_name ?? '—'}`,
          `Número de cuenta: ${settings.account_number ?? '—'}`,
          `Tipo de cuenta: ${settings.account_type ?? '—'}`,
          `Titular: ${settings.account_holder ?? '—'}`,
        ]
      : ['(Datos bancarios no configurados)']

    const text = [
      `Empresa: ${ctx.account.name} (${ctx.account.id})`,
      `Reportado por: ${user?.email ?? 'sin correo'}`,
      `Fecha: ${new Date().toLocaleString('es-GT')}`,
      '',
      'Datos bancarios de referencia:',
      ...bankLines,
    ].join('\n')

    try {
      await sendEmail({
        account: 'payments',
        to: PAYMENTS_INBOX,
        subject: `Reporte de pago — ${ctx.account.name}`,
        text,
      })
    } catch (err) {
      if (err instanceof EmailError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
