// ============================================================
// Transactional email — server-side only.
//
// wacrm had no application email before partner invitations
// (Supabase Auth sends its own auth emails). This is the single
// app-level sender; add future transactional mail here rather than
// wiring another provider.
//
// Providers (first configured wins):
//
//   1. SMTP (nodemailer) — any SMTP server: Gmail, Outlook, Zoho,
//      SES, your host's mail server…
//        SMTP_HOST=smtp.gmail.com
//        SMTP_PORT=465            # 465 = implicit TLS, 587 = STARTTLS
//        SMTP_SECURE=true         # optional; defaults to true on 465
//        SMTP_USER=you@gmail.com
//        SMTP_PASS=app-password
//        EMAIL_FROM="WSCRM <you@gmail.com>"
//
//   2. Resend HTTP API
//        RESEND_API_KEY=re_...
//        EMAIL_FROM="WSCRM <no-reply@your-verified-domain.com>"
//
// With neither configured the email is not sent: the call resolves
// `{ sent: false, reason: 'not_configured' }` and logs the subject +
// recipient (never the body — it carries a live signup token). The
// caller decides how to degrade (the Partners API hands the inviter
// the link to share manually).
// ============================================================

import nodemailer, { type Transporter } from "nodemailer";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendEmailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "provider_error" };

type Env = Record<string, string | undefined>;

function smtpConfigured(env: Env): boolean {
  return !!env.SMTP_HOST?.trim() && !!env.EMAIL_FROM?.trim();
}

function resendConfigured(env: Env): boolean {
  return !!env.RESEND_API_KEY?.trim() && !!env.EMAIL_FROM?.trim();
}

export function isEmailConfigured(env: Env = process.env): boolean {
  return smtpConfigured(env) || resendConfigured(env);
}

// One pooled transporter per distinct SMTP config, reused across sends.
let cachedTransport: { key: string; transport: Transporter } | null = null;

function smtpTransport(env: Env): Transporter {
  const port = Number(env.SMTP_PORT) || 587;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE.trim() === "true" : port === 465;
  const user = env.SMTP_USER?.trim();
  const key = [env.SMTP_HOST, port, secure, user].join("|");
  if (cachedTransport?.key !== key) {
    cachedTransport = {
      key,
      transport: nodemailer.createTransport({
        host: env.SMTP_HOST!.trim(),
        port,
        secure,
        auth: user ? { user, pass: env.SMTP_PASS ?? "" } : undefined,
        pool: true,
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      }),
    };
  }
  return cachedTransport.transport;
}

async function sendViaSmtp(message: EmailMessage, env: Env): Promise<SendEmailResult> {
  try {
    const info = await smtpTransport(env).sendMail({
      from: env.EMAIL_FROM!.trim(),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { sent: true, id: info.messageId ?? null };
  } catch (err) {
    console.error("[email] SMTP send failed:", err instanceof Error ? err.message : err);
    return { sent: false, reason: "provider_error" };
  }
}

export async function sendEmail(
  message: EmailMessage,
  env: Env = process.env,
): Promise<SendEmailResult> {
  if (smtpConfigured(env)) return sendViaSmtp(message, env);

  if (!resendConfigured(env)) {
    console.warn(
      "[email] no email provider configured (SMTP_HOST or RESEND_API_KEY, plus EMAIL_FROM) — email not sent:",
      { to: message.to, subject: message.subject },
    );
    return { sent: false, reason: "not_configured" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM!.trim(),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[email] provider rejected message:", res.status, detail.slice(0, 500));
      return { sent: false, reason: "provider_error" };
    }

    const data = (await res.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: data?.id ?? null };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { sent: false, reason: "provider_error" };
  }
}

/** Escape text for interpolation into an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
