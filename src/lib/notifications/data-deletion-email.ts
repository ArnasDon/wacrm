import type { DataDeletionRequest } from '@/lib/eter/repo/data-deletion-requests.repo'
import { sendWhatsAppAdminAlert } from './whatsapp-admin-alert'

// ============================================================
// Notification for a new RGPD data-deletion request
// (data-deletion.ts calls this once per newly-created request).
//
// This repo (EterWA) has NO Google Service Account / Gmail API
// infrastructure today, `GOOGLE_SERVICE_ACCOUNT_JSON` and
// `GMAIL_IMPERSONATE_USER` are conventions used in other Eter Growth
// projects (see the "Envio de Email Interno" rule in the org-level
// CLAUDE.md) but nothing in this codebase reads them or knows how to
// impersonate a Workspace user via domain-wide delegation. Wiring a
// real email send is explicitly out of scope for this fix.
//
// The DEFAULT sender no longer only logs: it sends a real WhatsApp
// alert to Ricardo (`sendWhatsAppAdminAlert`,
// src/lib/notifications/whatsapp-admin-alert.ts) carrying the same
// subject + text, via the WhatsApp Business number of the account the
// request came from. Rather than invent a second, undocumented mail
// channel (Resend is reserved for outreach in other projects), this
// reuses the mechanism EterWA already has for sending WhatsApp
// messages — same reasoning as aisdr-approval-alert.ts, its sibling
// in this directory.
//
// Nothing here is a single point of failure for the underlying data:
// the deletion request is written to `data_deletion_requests` before
// this is ever called (see data-deletion.ts — best-effort, never
// throws), so a failed/unreachable WhatsApp send never loses the
// request, only delays a human noticing it.
//
// To add real email on top of this later: implement a second
// `EmailSender` (Google Service Account + domain-wide delegation,
// matching the org convention) and call `configureEmailSender` with
// it, or compose it into `WhatsAppFallbackEmailSender.send` below.
// ============================================================

export interface EmailMessage {
  to: string[]
  subject: string
  text: string
  /** Account whose WhatsApp Business number should send the fallback
   *  alert — required for the default sender to resolve a
   *  `whatsapp_config`. */
  accountId?: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

// Named `EmailSender`/`EmailMessage` for historical reasons (the
// `to`/`subject` shape matches the geral@/devs@ email this was
// designed to send), but the DEFAULT implementation below sends a
// real WhatsApp alert instead — see the module header. Email (Google
// Service Account) stays out of scope for this fix.
class WhatsAppFallbackEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    // Always loud in the logs first — an operator tailing logs must
    // never depend on Meta being reachable to see the request exists.
    console.warn(
      '[data-deletion-email] sem infraestrutura de email (Google Service Account) neste repo — ' +
        `a enviar como alerta WhatsApp em alternativa. to=${message.to.join(', ')} subject="${message.subject}"`,
    )

    if (!message.accountId) {
      console.error(
        '[data-deletion-email] alerta sem accountId associado — não é possível resolver o ' +
          'WhatsApp Business number para o enviar. Ficou apenas no log acima.',
      )
      return
    }

    await sendWhatsAppAdminAlert(`${message.subject}\n\n${message.text}`, {
      accountId: message.accountId,
    })
  }
}

let activeSender: EmailSender = new WhatsAppFallbackEmailSender()

/** Test / override hook, swap in a different `EmailSender` without
 *  touching every call site. */
export function configureEmailSender(sender: EmailSender): void {
  activeSender = sender
}

/** Reset to the default (real WhatsApp fallback) sender. Used by
 *  tests to avoid leaking a mock sender across test files. */
export function resetEmailSender(): void {
  activeSender = new WhatsAppFallbackEmailSender()
}

const NOTIFY_RECIPIENTS = ['geral@etergrowth.com', 'devs@etergrowth.com']

function buildNotificationText(request: DataDeletionRequest): string {
  const lines = [
    'Novo pedido de eliminação de dados (RGPD) recebido via WhatsApp.',
    '',
    `Telefone: ${request.phone}`,
    `Nome de perfil: ${request.profileName ?? '(desconhecido)'}`,
    `Pedido registado em: ${request.requestedAt.toISOString()}`,
    `ID do pedido: ${request.id}`,
    '',
    'Estado atual: pending. A eliminação efetiva dos dados não é automática, ' +
      'a equipa deve tratar este pedido no prazo máximo de 30 dias.',
  ]
  return lines.join('\n')
}

/**
 * Best-effort notification to geral@/devs@ for a newly-created
 * deletion request. Never throws, a failed/unconfigured send must
 * not roll back or fail the request itself, which is already
 * persisted by the time this is called.
 */
export async function sendDataDeletionNotification(request: DataDeletionRequest): Promise<void> {
  try {
    await activeSender.send({
      to: NOTIFY_RECIPIENTS,
      subject: `Pedido de eliminação de dados RGPD, ${request.phone}`,
      text: buildNotificationText(request),
      accountId: request.accountId,
    })
  } catch (err) {
    console.error('[data-deletion-email] failed to send notification:', err)
  }
}
