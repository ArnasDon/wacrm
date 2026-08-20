import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAccountRole, type AccountRole } from '@/lib/auth/roles'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendEmail, EmailError } from '@/lib/email/send'

const SEATS_INBOX = 'asistentedechat@gmail.com'
const SEAT_PRICE_QUETZALES = 100

/** 5 MB — matches the image cap used elsewhere for account-scoped uploads. */
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024
const ALLOWED_RECEIPT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_NOTES_LEN = 500

const ROLE_LABEL: Record<AccountRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  agent: 'Agente / vendedor',
  viewer: 'Visor',
}

/**
 * POST /api/billing/request-seat  (admin+)
 *
 * "Solicitud de accesos" — a company's admin/owner asks Angel to
 * unlock one more member seat (Q100/seat). Emails SEATS_INBOX with
 * the company, who's requesting it, the intended role for the new
 * user, optional notes, and a required photo of the payment receipt
 * — same "the email IS the record" shape as /api/billing/report-payment,
 * since there's no persisted "seat request" table. Angel reviews the
 * receipt and clicks "+1 asiento" for that company in /admin himself;
 * this route never touches accounts.seat_limit.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limit = await checkSharedRateLimit(`seat-request:${ctx.userId}`, RATE_LIMITS.seatRequest)
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData()

    const roleRaw = form.get('role')
    if (!isAccountRole(roleRaw) || roleRaw === 'owner') {
      return NextResponse.json(
        { error: "El rol debe ser Administrador, Agente o Visor." },
        { status: 400 },
      )
    }
    const role = roleRaw

    const notesRaw = form.get('notes')
    const notes = typeof notesRaw === 'string' ? notesRaw.trim().slice(0, MAX_NOTES_LEN) : ''

    const receipt = form.get('receipt')
    if (!(receipt instanceof File) || receipt.size === 0) {
      return NextResponse.json(
        { error: 'Debes adjuntar una foto del comprobante de pago.' },
        { status: 400 },
      )
    }
    if (!ALLOWED_RECEIPT_TYPES.has(receipt.type)) {
      return NextResponse.json(
        { error: 'El comprobante debe ser una imagen (JPG, PNG o WEBP).' },
        { status: 400 },
      )
    }
    if (receipt.size > MAX_RECEIPT_BYTES) {
      return NextResponse.json(
        { error: 'La imagen del comprobante no puede superar 5 MB.' },
        { status: 400 },
      )
    }
    const receiptBuffer = Buffer.from(await receipt.arrayBuffer())

    const [{ data: accountRow }, { count: memberCount }, { data: authData }] = await Promise.all([
      ctx.supabase.from('accounts').select('seat_limit').eq('id', ctx.accountId).maybeSingle(),
      ctx.supabase
        .from('profiles')
        .select('user_id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      ctx.supabase.auth.getUser(),
    ])

    const text = [
      `Empresa: ${ctx.account.name} (${ctx.account.id})`,
      `Solicitado por: ${authData.user?.email ?? 'sin correo'}`,
      `Fecha: ${new Date().toLocaleString('es-GT')}`,
      `Cupos actuales: ${memberCount ?? '—'} / ${accountRow?.seat_limit ?? '—'}`,
      '',
      `Rol del nuevo usuario: ${ROLE_LABEL[role]}`,
      `Costo: Q${SEAT_PRICE_QUETZALES} por usuario adicional`,
      notes ? `Notas: ${notes}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n')

    try {
      await sendEmail({
        account: 'payments',
        to: SEATS_INBOX,
        subject: `Solicitud de acceso adicional — ${ctx.account.name}`,
        text,
        attachments: [
          {
            filename: receipt.name || 'comprobante.jpg',
            content: receiptBuffer,
            contentType: receipt.type,
          },
        ],
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
