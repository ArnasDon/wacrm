import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { EmailAccountDoc } from '@/lib/db/types'
import { EmailError, sendWithAccount } from '@/lib/email/send'
import { NotFoundError, readJson } from '@/lib/http/errors'
import { email as emailV } from '@/lib/http/validate'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

/** PATCH { isDefault: true } — choose the sending mailbox. Admin+. */
export async function PATCH(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const accounts = await scopedCollection<EmailAccountDoc>(ctx, 'email_accounts')
    if (!(await accounts.findById(id))) throw new NotFoundError('Email account not found')
    await accounts.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } })
    await accounts.updateById(id, { $set: { isDefault: true } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const accounts = await scopedCollection<EmailAccountDoc>(ctx, 'email_accounts')
    const res = await accounts.deleteOne({ _id: id })
    if (res.deletedCount === 0) throw new NotFoundError('Email account not found')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST { to } — send a test email from this mailbox. Admin+. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
    if (!limit.success) return rateLimitResponse(limit)
    const id = parseId((await params).id)
    const body = await readJson(request)
    const to = emailV(body.to, 'to')
    const accounts = await scopedCollection<EmailAccountDoc>(ctx, 'email_accounts')
    const acc = await accounts.findById(id)
    if (!acc) throw new NotFoundError('Email account not found')
    let ok = true
    let message = `Test email sent to ${to}`
    try {
      await sendWithAccount(acc, {
        to,
        subject: 'Test email from your WhatsApp sales CRM',
        text: 'If you can read this, your mailbox is connected. Receipts and invoices will be sent from this address.',
        html: '<p>If you can read this, your mailbox is connected.</p><p>Receipts and invoices will be sent from this address.</p>',
      })
    } catch (err) {
      ok = false
      message = err instanceof EmailError ? err.message : 'Sending failed'
    }
    await accounts.updateById(id, { $set: { lastTestAt: new Date(), lastTestOk: ok } })
    return NextResponse.json({ ok, message })
  } catch (err) {
    return toErrorResponse(err)
  }
}
