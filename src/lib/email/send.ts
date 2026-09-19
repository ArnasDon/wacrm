import 'server-only'
import { lookup } from 'node:dns/promises'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type { EmailAccountDoc } from '@/lib/db/types'
import { decrypt } from '@/lib/security/secrets'
import { isPrivateAddress } from '@/lib/security/safe-fetch'

// ============================================================
// Outbound email from the BUSINESS's own mailbox:
//   - SMTP: any provider (Gmail/Google Workspace app password,
//     Zoho, Outlook, cPanel hosting mail...)
//   - Gmail OAuth: "Connect Google" → gmail.send scope → sent via
//     the Gmail REST API with a refresh token.
//
// SMTP hosts are user-supplied, so they get the same private-
// network guard as webhooks (and a port allowlist) — otherwise the
// "test connection" button is a port scanner.
// ============================================================

export interface OutboundEmail {
  to: string
  subject: string
  html: string
  text: string
  attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }>
}

export class EmailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailError'
  }
}

const SMTP_PORTS = new Set([25, 465, 587, 2525])

export async function assertSafeSmtpHost(host: string, port: number): Promise<void> {
  if (!SMTP_PORTS.has(port)) throw new EmailError('SMTP port must be 465, 587, 25 or 2525')
  if (!/^[a-z0-9.-]{1,253}$/i.test(host)) throw new EmailError('Invalid SMTP host')
  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new EmailError('SMTP host does not resolve')
  })
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new EmailError('SMTP host points to a private network address')
  }
}

function fromHeader(acc: EmailAccountDoc): string {
  const name = (acc.fromName ?? '').replace(/["\r\n]/g, '')
  return name ? `"${name}" <${acc.fromEmail}>` : acc.fromEmail
}

async function sendViaSmtp(acc: EmailAccountDoc, mail: OutboundEmail): Promise<void> {
  if (!acc.smtp) throw new EmailError('SMTP settings missing')
  await assertSafeSmtpHost(acc.smtp.host, acc.smtp.port)
  const transport = nodemailer.createTransport({
    host: acc.smtp.host,
    port: acc.smtp.port,
    secure: acc.smtp.secure,
    auth: { user: acc.smtp.username, pass: decrypt(acc.smtp.passwordEnc) },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  try {
    await transport.sendMail({
      from: fromHeader(acc),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        contentType: a.contentType,
      })),
    })
  } catch (err) {
    const msg = (err as Error).message ?? ''
    throw new EmailError(/auth|535|534/i.test(msg) ? 'SMTP login failed — check username / app password' : 'SMTP send failed')
  }
}

export async function gmailAccessToken(refreshToken: string): Promise<string> {
  const id = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) throw new EmailError('Gmail OAuth is not configured on this server')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new EmailError('Google rejected the stored token — reconnect Gmail')
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new EmailError('Google returned no access token')
  return json.access_token
}

async function sendViaGmail(acc: EmailAccountDoc, mail: OutboundEmail): Promise<void> {
  if (!acc.gmail) throw new EmailError('Gmail connection missing')
  const accessToken = await gmailAccessToken(decrypt(acc.gmail.refreshTokenEnc))
  const mime = await new MailComposer({
    from: fromHeader(acc),
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    attachments: mail.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content),
      contentType: a.contentType,
    })),
  })
    .compile()
    .build()
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }),
  })
  if (!res.ok) throw new EmailError(`Gmail send failed (${res.status})`)
}

export async function sendWithAccount(acc: EmailAccountDoc, mail: OutboundEmail): Promise<void> {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mail.to)) throw new EmailError('Invalid recipient address')
  if (acc.provider === 'gmail') return sendViaGmail(acc, mail)
  return sendViaSmtp(acc, mail)
}

export async function getDefaultEmailAccount(ctx: AuthContext): Promise<EmailAccountDoc | null> {
  const accounts = await scopedCollection<EmailAccountDoc>(ctx, 'email_accounts')
  return (await accounts.findOne({ isDefault: true })) ?? (await accounts.findOne({}))
}

/** Send from the account's default mailbox. Returns false when none is linked. */
export async function sendBusinessEmail(ctx: AuthContext, mail: OutboundEmail): Promise<boolean> {
  const acc = await getDefaultEmailAccount(ctx)
  if (!acc) return false
  await sendWithAccount(acc, mail)
  return true
}

/** System mail (password resets) — SYSTEM_SMTP_URL, not a tenant mailbox. */
export async function sendSystemEmail(mail: OutboundEmail): Promise<boolean> {
  const url = process.env.SYSTEM_SMTP_URL
  if (!url) return false
  const transport = nodemailer.createTransport(url)
  await transport.sendMail({
    from: process.env.SYSTEM_EMAIL_FROM || 'no-reply@localhost',
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  })
  return true
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
