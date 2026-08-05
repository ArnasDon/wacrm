import { Resend } from "resend"
import { supabaseAdmin } from "@/lib/telnyx/admin-client"
import { decrypt } from "@/lib/whatsapp/encryption"

// Correo transaccional vía Resend (Fase 1).
// - Config en `email_config` (migración 040), API key ENCRIPTADA (AES-256-GCM,
//   mismo `decrypt` de whatsapp_config / ai_configs).
// - API de envío verificada en context7 (resend): `emails.send({from,to,subject,html,reply_to})`
//   → resolved `{ data: { id }, error | null }`.

export class EmailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmailError"
  }
}

export interface EmailConfig {
  apiKey: string
  fromEmail: string
  replyTo: string | null
}

export interface SendEmailInput {
  to: string
  subject: string
  html: string
}

/**
 * Cliente Resend mínimo (un método: enviar).
 * Devuelve el id del mensaje de Resend, o lanza `EmailError`.
 */
export function createResendClient(apiKey: string) {
  const resend = new Resend(apiKey)
  return {
    async send(fromEmail: string, replyTo: string | null, input: SendEmailInput) {
      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      })
      if (error) throw new EmailError(`Resend error: ${error.message}`)
      return { id: data?.id ?? "" }
    },
  }
}

/**
 * Carga y desencripta la config de email del account desde `email_config`.
 * Cliente service-role (same rationale que loadTelnyxApiKey).
 */
export async function loadEmailConfig(accountId: string): Promise<EmailConfig> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from("email_config")
    .select("resend_api_key_encrypted, from_email, reply_to")
    .eq("account_id", accountId)
    .maybeSingle()

  if (error || !data) {
    throw new EmailError("Email config not found for account")
  }
  return {
    apiKey: decrypt(data.resend_api_key_encrypted),
    fromEmail: data.from_email,
    replyTo: data.reply_to ?? null,
  }
}

/** Envía un email: carga config del account, desencripta la key y lo manda. */
export async function sendEmail(
  accountId: string,
  input: SendEmailInput,
): Promise<{ id: string }> {
  const { apiKey, fromEmail, replyTo } = await loadEmailConfig(accountId)
  const client = createResendClient(apiKey)
  return client.send(fromEmail, replyTo, input)
}