import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  isOutsideSessionWindowError,
} from '@/lib/whatsapp/phone-utils'
import { findApprovedTemplateByName } from '@/lib/eter/repo/message-templates.repo'

// ============================================================
// Shared, low-level WhatsApp sender for operational admin alerts —
// AI SDR approval-forward failures (aisdr-approval-alert.ts) and RGPD
// deletion-request notifications (data-deletion-email.ts /
// data-deletion.ts). Sends a WhatsApp text (or, outside Meta's 24h
// customer-service window, an APPROVED template) to Ricardo's number
// (AISDR_ALERT_ADMIN_PHONE), via the WhatsApp Business number
// configured for the account that owns the failure being reported.
//
// Deliberately NOT built on send-message.ts / meta-send.ts — both
// require a `contacts` row for the recipient (every lookup is scoped
// to `contactId` + `accountId`), and Ricardo is not a CRM contact of
// the accounts he administers. This calls the same underlying Meta
// Cloud API primitives (meta-api.ts) those modules build on, with the
// same phone-sanitize / access-token-decrypt steps, without the
// contact/conversation bookkeeping — an operational alert is not a
// CRM message and is intentionally never written to `messages`.
//
// Lazy by design: the service-role client and every lookup happen
// inside `sendWhatsAppAdminAlert`, on first call, not at module load —
// this is what lets the two call sites stay "on by default" without
// any startup wiring (see the callers' file headers for why that
// mattered here: a configure-function nobody calls was exactly how
// both alert channels ended up silently log-only before this fix).
// ============================================================

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

/**
 * Name of the APPROVED template used to alert Ricardo when a send
 * falls outside Meta's 24h customer-service window. Provision this in
 * WhatsApp Manager (one {{1}} body parameter carrying the alert text
 * is enough) before relying on out-of-window alerts — see
 * docs/eter-agent-config.md. Meta caps template parameters at 1024
 * chars; a longer alert text is truncated before being sent as the
 * param (see `sendWhatsAppAdminAlert` below).
 */
export const ADMIN_ALERT_TEMPLATE_NAME = 'eter_admin_alert'

const TEMPLATE_PARAM_MAX = 1024

export type AdminAlertOutcome =
  | { sent: true; via: 'text' | 'template' }
  | { sent: false; reason: string }

/**
 * Best-effort but LOUD: never throws (every call site is itself a
 * best-effort alert path — the underlying failure it's reporting is
 * already durably persisted before this is called), but every failure
 * to actually deliver the WhatsApp alert is logged clearly with a
 * `reason`, never swallowed silently.
 */
export async function sendWhatsAppAdminAlert(
  text: string,
  opts: { accountId: string },
): Promise<AdminAlertOutcome> {
  const rawPhone = process.env.AISDR_ALERT_ADMIN_PHONE
  if (!rawPhone) {
    console.error(
      '[whatsapp-admin-alert] AISDR_ALERT_ADMIN_PHONE não configurada, alerta NÃO enviado. ' +
        `Mensagem perdida: ${text}`,
    )
    return { sent: false, reason: 'admin_phone_not_configured' }
  }

  const to = sanitizePhoneForMeta(rawPhone)
  if (!isValidE164(to)) {
    console.error(
      `[whatsapp-admin-alert] AISDR_ALERT_ADMIN_PHONE inválido ("${rawPhone}"), alerta NÃO enviado.`,
    )
    return { sent: false, reason: 'admin_phone_invalid' }
  }

  const db = admin()
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', opts.accountId)
    .maybeSingle()

  if (configError || !config) {
    console.error(
      `[whatsapp-admin-alert] whatsapp_config não encontrado para account_id=${opts.accountId}, ` +
        `alerta NÃO enviado. Mensagem perdida: ${text}`,
    )
    return { sent: false, reason: 'whatsapp_config_not_found' }
  }

  let accessToken: string
  try {
    accessToken = decrypt((config as { access_token: string }).access_token)
  } catch (err) {
    console.error('[whatsapp-admin-alert] falha a decifrar o access_token do WhatsApp:', err)
    return { sent: false, reason: 'access_token_decrypt_failed' }
  }

  const phoneNumberId = (config as { phone_number_id: string }).phone_number_id

  try {
    await sendTextMessage({ phoneNumberId, accessToken, to, text })
    return { sent: true, via: 'text' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isOutsideSessionWindowError(message)) {
      console.error('[whatsapp-admin-alert] falha a enviar alerta por WhatsApp (texto livre):', message)
      return { sent: false, reason: `send_failed: ${message}` }
    }
    // Outside the 24h window — Meta rejects free text. Fall through to
    // the approved-template path below; never retry with free text.
  }

  const template = await findApprovedTemplateByName(db, opts.accountId, ADMIN_ALERT_TEMPLATE_NAME).catch(
    (err) => {
      console.error('[whatsapp-admin-alert] falha a procurar o template de alerta aprovado:', err)
      return null
    },
  )

  if (!template) {
    console.error(
      '[whatsapp-admin-alert] fora da janela de 24h e sem template aprovado ' +
        `"${ADMIN_ALERT_TEMPLATE_NAME}" configurado para account_id=${opts.accountId}. ` +
        `Alerta NÃO enviado. Mensagem perdida: ${text}`,
    )
    return { sent: false, reason: 'outside_window_no_template' }
  }

  try {
    await sendTemplateMessage({
      phoneNumberId,
      accessToken,
      to,
      templateName: template.name,
      language: template.language,
      params: [text.length > TEMPLATE_PARAM_MAX ? `${text.slice(0, TEMPLATE_PARAM_MAX - 1)}…` : text],
    })
    return { sent: true, via: 'template' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[whatsapp-admin-alert] falha a enviar o template de alerta:', message)
    return { sent: false, reason: `template_send_failed: ${message}` }
  }
}
