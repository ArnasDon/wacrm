// ============================================================
// Alert channel for AI SDR approval-forward failures — fired when
// forwardApprovalDecision (src/lib/eter/aisdr-approval-forward.ts)
// exhausts every retry for a single webhook delivery, and again if the
// reprocessing cron later gives up entirely (see
// AISDR_FORWARD_MAX_QUEUE_ATTEMPTS).
//
// The default sender is a REAL delivery channel: a WhatsApp message to
// Ricardo's number (`sendWhatsAppAdminAlert`,
// src/lib/notifications/whatsapp-admin-alert.ts), sent via the same
// WhatsApp Business number that received the approval tap being
// reported (`accountId` on `ApprovalForwardFailureDetails`). It is
// wired up on module load, not behind a configure-call nobody
// remembers to make — a log line nobody reads was exactly the gap
// that let 9 approvals sit stuck for days before this fix, and a
// silently-unconfigured `AlertSender` would reproduce the same
// failure mode one level up.
//
// Console logging still happens on every send (loud in server logs
// too), and nothing here is a single point of failure for the
// underlying data: the triggering failure is always ALSO persisted in
// `aisdr_approval_forwards` (status='failed'/'gave_up') before this is
// ever called.
// ============================================================

import { sendWhatsAppAdminAlert } from './whatsapp-admin-alert'

export interface AlertMessage {
  text: string
  /** Account whose WhatsApp Business number should send this alert.
   *  Required for the default sender to resolve a `whatsapp_config` —
   *  see `sendWhatsAppAdminAlert`. Optional only so a caller without
   *  an account context (there are none today) still compiles; the
   *  default sender logs loudly and gives up if it's missing. */
  accountId?: string
}

export interface AlertSender {
  send(message: AlertMessage): Promise<void>
}

class WhatsAppAdminAlertSender implements AlertSender {
  async send(message: AlertMessage): Promise<void> {
    // Always loud in the logs, regardless of whether the WhatsApp send
    // below succeeds — an operator tailing logs must never depend on
    // Meta being reachable to see that something went wrong.
    console.error(`[aisdr-approval-alert] ${message.text}`)

    if (!message.accountId) {
      console.error(
        '[aisdr-approval-alert] alerta sem accountId associado — não é possível resolver ' +
          'o WhatsApp Business number para o enviar. Ficou apenas no log acima.',
      )
      return
    }

    await sendWhatsAppAdminAlert(message.text, { accountId: message.accountId })
  }
}

let activeSender: AlertSender = new WhatsAppAdminAlertSender()

/** Test / override hook, swap in a different `AlertSender` without
 *  touching either call site below. */
export function configureAisdrApprovalAlertSender(sender: AlertSender): void {
  activeSender = sender
}

/** Reset to the default (real WhatsApp) sender. Used by tests to avoid
 *  leaking a mock sender across test files. */
export function resetAisdrApprovalAlertSender(): void {
  activeSender = new WhatsAppAdminAlertSender()
}

export interface ApprovalForwardFailureDetails {
  approvalId: number
  decision: 'send' | 'discard'
  waMessageId: string
  attempts: number
  error: string
  /** True once the reprocessing cron has also exhausted its retry
   *  budget — a terminal failure that needs a human to look at
   *  `aisdr_approval_forwards` directly. */
  gaveUp: boolean
  /** Account whose WhatsApp Business number received the approval tap
   *  being reported — drives which `whatsapp_config` the default
   *  sender uses to deliver this alert. */
  accountId: string
}

function buildAlertText(details: ApprovalForwardFailureDetails): string {
  const headline = details.gaveUp
    ? 'FALHA DEFINITIVA a reencaminhar decisão de aprovação AI SDR'
    : 'Falha a reencaminhar decisão de aprovação AI SDR, em fila para nova tentativa'
  return [
    `${headline}.`,
    `approval_id=${details.approvalId} decisao=${details.decision} tentativas=${details.attempts}`,
    `wa_message_id=${details.waMessageId}`,
    `erro: ${details.error}`,
  ].join(' ')
}

/**
 * Best-effort alert, never throws. A failure to alert must not affect
 * the caller: the underlying failure is already durably recorded in
 * `aisdr_approval_forwards` before this is called.
 */
export async function alertAisdrApprovalForwardFailed(
  details: ApprovalForwardFailureDetails,
): Promise<void> {
  try {
    await activeSender.send({ text: buildAlertText(details), accountId: details.accountId })
  } catch (err) {
    console.error('[aisdr-approval-alert] failed to send the alert itself:', err)
  }
}
