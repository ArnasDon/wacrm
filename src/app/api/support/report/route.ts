import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendEmail, EmailError, type EmailAttachment } from '@/lib/email/send'

const SUPPORT_INBOX = 'asistentedechat@gmail.com'
const MAX_SCREENSHOTS = 5
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5MB each — stays well under Gmail's ~25MB total limit at 5 files

/**
 * POST /api/support/report  (any authenticated role)
 *
 * multipart/form-data: name, error_description, screenshots (0-5 image
 * files). Emails SUPPORT_INBOX with the reporting account/user context
 * plus the screenshots as direct attachments — deliberately NOT
 * uploaded to Supabase Storage first, so no permanent history of
 * (potentially sensitive customer) screenshots accumulates in the
 * project; the email itself is the only record.
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('viewer')
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const limit = await checkSharedRateLimit(`support-report:${ctx.userId}`, RATE_LIMITS.supportReport)
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
    }

    const name = String(form.get('name') ?? '').trim()
    const errorDescription = String(form.get('error_description') ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!errorDescription) {
      return NextResponse.json({ error: 'Error description is required' }, { status: 400 })
    }

    const files = form.getAll('screenshots').filter((f): f is File => f instanceof File)
    if (files.length > MAX_SCREENSHOTS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_SCREENSHOTS} capturas de pantalla` },
        { status: 400 },
      )
    }
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        return NextResponse.json({ error: 'Solo se aceptan imágenes' }, { status: 400 })
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Cada captura debe pesar menos de 5MB' }, { status: 400 })
      }
    }

    const attachments: EmailAttachment[] = await Promise.all(
      files.map(async (file, index) => ({
        filename: file.name || `captura-${index + 1}.png`,
        content: Buffer.from(await file.arrayBuffer()),
        contentType: file.type,
      })),
    )

    const {
      data: { user },
    } = await ctx.supabase.auth.getUser()

    const text = [
      `Cuenta: ${ctx.account.name} (${ctx.account.id})`,
      `Reportado por: ${name} <${user?.email ?? 'sin correo'}>`,
      '',
      'Error reportado:',
      errorDescription,
    ].join('\n')

    try {
      await sendEmail({
        account: 'support',
        to: SUPPORT_INBOX,
        subject: `Reporte de error — ${ctx.account.name} — ${name}`,
        text,
        attachments,
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
