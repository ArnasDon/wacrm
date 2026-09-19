import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { EmailAccountDoc } from '@/lib/db/types'
import { assertSafeSmtpHost, EmailError } from '@/lib/email/send'
import { readJson, ValidationError } from '@/lib/http/errors'
import { bool, email as emailV, num, optStr, str } from '@/lib/http/validate'
import { encrypt } from '@/lib/security/secrets'

function shape(a: EmailAccountDoc) {
  return {
    id: a._id,
    provider: a.provider,
    label: a.label,
    fromName: a.fromName,
    fromEmail: a.fromEmail,
    isDefault: a.isDefault,
    smtp: a.smtp ? { host: a.smtp.host, port: a.smtp.port, secure: a.smtp.secure, username: a.smtp.username } : null,
    lastTestAt: a.lastTestAt,
    lastTestOk: a.lastTestOk,
  }
}

/** GET — linked mailboxes. Admin+. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const accounts = await scopedCollection<EmailAccountDoc>(ctx, 'email_accounts')
    const rows = await accounts.find({}).sort({ createdAt: 1 }).toArray()
    return NextResponse.json({
      accounts: rows.map(shape),
      gmailOAuthAvailable: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST — add an SMTP mailbox. For a Gmail / Google Workspace address
 * without OAuth, use smtp.gmail.com:465 with an App Password.
 * Admin+.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const host = str(body.host, 'host', { max: 253 }).toLowerCase()
    const port = num(body.port ?? 465, 'port', { integer: true, min: 1, max: 65535 })
    try {
      await assertSafeSmtpHost(host, port)
    } catch (err) {
      if (err instanceof EmailError) throw new ValidationError(err.message)
      throw err
    }
    const fromEmail = emailV(body.fromEmail, 'fromEmail')
    const accounts = await scopedCollection<EmailAccountDoc>(ctx, 'email_accounts')
    if ((await accounts.countDocuments({})) >= 10) throw new ValidationError('Too many email accounts')
    const isFirst = (await accounts.countDocuments({})) === 0
    const created = await accounts.insertOne({
      provider: 'smtp',
      label: optStr(body.label, 'label', 80) ?? fromEmail,
      fromName: optStr(body.fromName, 'fromName', 80),
      fromEmail,
      isDefault: isFirst,
      smtp: {
        host,
        port,
        secure: bool(body.secure, 'secure', port === 465),
        username: str(body.username, 'username', { max: 254 }),
        passwordEnc: encrypt(str(body.password, 'password', { max: 500, trim: false })),
      },
      gmail: null,
      lastTestAt: null,
      lastTestOk: null,
    })
    return NextResponse.json({ account: shape(created) }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
