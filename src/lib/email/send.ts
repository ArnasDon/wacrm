import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Which Gmail inbox to send from. Chat Sandía uses two separate
 * mailboxes for two separate purposes (support reports vs. payment
 * reports) so each lands in its own inbox rather than mixed together —
 * each needs its own Gmail App Password (2FA-gated, not the account
 * password) set as env vars.
 */
export type EmailAccount = 'support' | 'payments'

const ACCOUNT_ENV: Record<EmailAccount, { user: string; pass: string }> = {
  support: { user: 'SUPPORT_GMAIL_USER', pass: 'SUPPORT_GMAIL_APP_PASSWORD' },
  payments: { user: 'PAYMENTS_GMAIL_USER', pass: 'PAYMENTS_GMAIL_APP_PASSWORD' },
}

export class EmailError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message)
    this.name = 'EmailError'
  }
}

const transporters = new Map<EmailAccount, Transporter>()

function getTransporter(account: EmailAccount): { transporter: Transporter; user: string } {
  const { user: userEnv, pass: passEnv } = ACCOUNT_ENV[account]
  const user = process.env[userEnv]
  const pass = process.env[passEnv]
  if (!user || !pass) {
    throw new EmailError(
      `Email is not configured yet (${userEnv} / ${passEnv} missing). Ask an admin to set them in EasyPanel.`,
      503,
    )
  }

  let transporter = transporters.get(account)
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })
    transporters.set(account, transporter)
  }
  return { transporter, user }
}

export interface EmailAttachment {
  filename: string
  content: Buffer
  contentType?: string
}

export interface SendEmailArgs {
  /** Which Gmail mailbox sends this — also becomes the "From" address. */
  account: EmailAccount
  to: string
  subject: string
  text: string
  attachments?: EmailAttachment[]
}

/**
 * Sends a plain-text email via Gmail SMTP (nodemailer), from one of
 * Chat Sandía's two Gmail mailboxes. Throws `EmailError` — including
 * a 503 when the account's env vars aren't set yet — so callers can
 * surface a clean error instead of a raw SMTP stack trace.
 */
export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const { transporter, user } = getTransporter(args.account)

  try {
    await transporter.sendMail({
      from: user,
      to: args.to,
      subject: args.subject,
      text: args.text,
      attachments: args.attachments,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown SMTP error'
    console.error(`[email/${args.account}] send failed:`, message)
    throw new EmailError(`Failed to send email: ${message}`, 502)
  }
}
