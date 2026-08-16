import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createDeletionRequest,
  cancelPendingDeletionRequest,
  markDeletionRequestNotified,
  type CreateDeletionRequestResult,
} from './repo/data-deletion-requests.repo'
import {
  recordDeletionInsertFailure,
  getFailedDeletionInsertsForRetry,
  markDeletionInsertRecovered,
  markDeletionInsertFailedAgain,
} from './repo/data-deletion-insert-failures.repo'
import { engineSendText } from '../automations/meta-send'
import { sendDataDeletionNotification } from '../notifications/data-deletion-email'
import { sendWhatsAppAdminAlert } from '../notifications/whatsapp-admin-alert'

// ============================================================
// RGPD data-deletion trigger, detects an inbound WhatsApp message
// whose FULL body (after normalization) is exactly "APAGAR" or
// "CANCELAR" and reacts deterministically. Called from the webhook
// route for every inbound TEXT message, before flow/automation/AI
// dispatch, see the call site in
// src/app/api/whatsapp/webhook/route.ts.
//
// Only an exact match on the whole message triggers this. "apagar" as
// one word inside a longer sentence ("não quero apagar nada") must
// NEVER trigger a deletion request, a false positive here has no
// undo path once a human acts on it, so the match is deliberately
// strict rather than permissive.
//
// This module never deletes any data itself. It only records the
// request in `data_deletion_requests` (status starts at 'pending')
// for a human on the ops team to action within the 30-day window
// promised in the reply text. See migration
// 041_data_deletion_requests.sql for the full design note.
//
// The INSERT itself gets the same protection level as the AI SDR
// approval-forward path (aisdr-approval-forward.ts): a dedicated
// try/catch around `createDeletionRequest`, persistence of a failed
// attempt for reprocessing (`data_deletion_insert_failures`, migration
// 043 — mirrors `aisdr_approval_forwards` per the instruction to reuse
// that pattern), and a real alert. Before this, an unexpected INSERT
// error propagated up through the webhook route's outer `.catch`,
// which reinterprets ANY thrown error here as "not a deletion command"
// (`outcome: 'none'`) — the request silently vanished and the lead
// never got the confirmation the public page promises. See
// `handleInboundDataDeletionRequest`'s DELETION_KEYWORD branch and
// `reprocessFailedDataDeletionInserts` below.
// ============================================================

export type DataDeletionOutcome =
  | 'none'
  | 'requested'
  | 'already_pending'
  | 'cancelled'
  | 'no_pending_to_cancel'
  // The exact-match "APAGAR" was recognized but the INSERT into
  // data_deletion_requests itself failed (transient DB error). The
  // attempt is queued in data_deletion_insert_failures for the
  // reprocessing cron and an admin alert is fired — see
  // recordFailedDeletionRequest below. Callers must treat this the
  // same as every other non-'none' outcome: the message was CONSUMED
  // by this handler and must not fall through to flow/automation/AI
  // dispatch.
  | 'insert_failed'

export interface HandleInboundDataDeletionArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string | null
  /** Sender-of-record for the reply this may send, same role
   *  `configOwnerUserId` plays everywhere else in the webhook route. */
  userId: string
  /** Normalized (digits-only) phone number, the identity the
   *  request/cancellation is keyed on. */
  phone: string
  /** WhatsApp profile name at the time of the request, best-effort. */
  profileName: string | null
  /** Raw inbound message body, exactly as received (not yet
   *  normalized), this function does the normalization itself so
   *  every call site agrees on the rule. */
  rawText: string
}

/**
 * Normalize a message body for the exact-match check: trim
 * surrounding whitespace, uppercase, and strip diacritics (accents).
 * Deliberately does NOT collapse internal whitespace or punctuation:
 * "APAGAR" only matches "APAGAR" (optionally accented/lowercased/
 * padded with leading-trailing spaces), never a phrase that merely
 * contains it.
 */
export function normalizeExactCommand(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .trim()
    .toUpperCase()
}

const DELETION_KEYWORD = 'APAGAR'
const CANCEL_KEYWORD = 'CANCELAR'

const CONFIRMATION_REPLY =
  'Recebemos o seu pedido de eliminação de dados. Os seus dados serão eliminados no prazo máximo de 30 dias ' +
  'e receberá confirmação. Se foi engano, responda CANCELAR.'

const ALREADY_PENDING_REPLY =
  'Já tínhamos registado o seu pedido de eliminação de dados. Os seus dados serão eliminados no prazo máximo ' +
  'de 30 dias e receberá confirmação. Se foi engano, responda CANCELAR.'

const CANCELLED_REPLY =
  'O seu pedido de eliminação de dados foi cancelado. Se voltar a precisar, envie APAGAR novamente.'

const NO_PENDING_TO_CANCEL_REPLY =
  'Não encontrámos nenhum pedido de eliminação de dados pendente para cancelar.'

// The INSERT failed and the request is only in the retry queue, not
// yet in `data_deletion_requests` — deliberately does NOT repeat the
// 30-day promise from CONFIRMATION_REPLY, that promise only holds once
// the request is durably recorded. Still acknowledges receipt so the
// lead isn't left wondering whether APAGAR was understood at all.
const INSERT_FAILED_REPLY =
  'Recebemos o seu pedido. Estamos a confirmar o registo, pode demorar alguns minutos. ' +
  'Se não receber confirmação em breve, contacte-nos.'

// Attempt GROUPS (webhook delivery counts as 1, each reprocessing-cron
// pickup counts as 1 more) before a `failed` row is given up on for
// good (`gave_up`, terminal). Same budget as
// AISDR_FORWARD_MAX_QUEUE_ATTEMPTS in aisdr-approval-forward.ts — no
// reason for RGPD deletion requests to get a different retry budget
// than approval forwards.
const MAX_INSERT_RETRY_ATTEMPTS = 5

async function reply(
  accountId: string,
  userId: string,
  conversationId: string,
  contactId: string | null,
  text: string,
): Promise<void> {
  try {
    await engineSendText({ accountId, userId, conversationId, contactId: contactId ?? '', text })
  } catch (err) {
    // Never let a failed reply throw out of the webhook, same
    // no-throw contract as pending-confirmation.ts / the rest of the
    // webhook cascade.
    console.error('[data-deletion] failed to send reply:', err)
  }
}

/**
 * Entry point called from the WhatsApp webhook for every inbound TEXT
 * message. Returns 'none' immediately (no-op) when the message isn't
 * an exact "APAGAR" / "CANCELAR", the caller's existing cascade
 * (flows/automations/AI auto-reply) is otherwise untouched.
 */
export async function handleInboundDataDeletionRequest(
  args: HandleInboundDataDeletionArgs,
): Promise<DataDeletionOutcome> {
  const { db, accountId, conversationId, contactId, userId, phone, profileName, rawText } = args

  const normalized = normalizeExactCommand(rawText)

  if (normalized === DELETION_KEYWORD) {
    // Dedicated try/catch — same protection level as the AI SDR
    // approval-forward path (see the module header). An unexpected
    // error here (transient DB blip, connection reset) must NEVER
    // propagate up to the webhook route's outer `.catch`, which would
    // reinterpret it as "not a deletion command at all" and silently
    // drop the request.
    let created: CreateDeletionRequestResult
    try {
      created = await createDeletionRequest(db, accountId, {
        conversationId,
        contactId,
        phone,
        profileName,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[data-deletion] createDeletionRequest failed, queuing for retry:', message)

      // Persist the failed attempt for reprocessing — never let a
      // failure to record the failure itself take down this handler.
      await recordDeletionInsertFailure(db, {
        accountId,
        conversationId,
        contactId,
        phone,
        profileName,
        error: message,
      }).catch((queueErr) =>
        console.error('[data-deletion] failed to queue the failed insert attempt itself:', queueErr),
      )

      // Loud alert — a lost RGPD deletion request is exactly the
      // failure mode this fix closes; it must not depend on someone
      // reading server logs to notice.
      await sendWhatsAppAdminAlert(
        `Falha ao registar pedido de eliminação de dados RGPD (APAGAR). telefone=${phone} ` +
          `account_id=${accountId} erro: ${message} — em fila para reprocessamento ` +
          '(data_deletion_insert_failures).',
        { accountId },
      ).catch((alertErr) =>
        console.error('[data-deletion] failed to send the insert-failure alert itself:', alertErr),
      )

      await reply(accountId, userId, conversationId, contactId, INSERT_FAILED_REPLY)
      return 'insert_failed'
    }

    const { request, created: wasCreated } = created

    if (wasCreated) {
      // Best-effort, never blocks the reply or the request itself. The
      // module contract says this never throws, but the `.catch` is
      // belt-and-braces, same pattern as every other best-effort
      // dispatch in this cascade (cancelFollowUpCadence, automations).
      await sendDataDeletionNotification(request).catch((err) =>
        console.error('[data-deletion] notification dispatch failed:', err),
      )
      await markDeletionRequestNotified(db, accountId, request.id).catch((err) =>
        console.error('[data-deletion] failed to mark request notified:', err),
      )
      await reply(accountId, userId, conversationId, contactId, CONFIRMATION_REPLY)
      return 'requested'
    }

    await reply(accountId, userId, conversationId, contactId, ALREADY_PENDING_REPLY)
    return 'already_pending'
  }

  if (normalized === CANCEL_KEYWORD) {
    const cancelled = await cancelPendingDeletionRequest(db, accountId, phone)

    if (cancelled) {
      await reply(accountId, userId, conversationId, contactId, CANCELLED_REPLY)
      return 'cancelled'
    }

    await reply(accountId, userId, conversationId, contactId, NO_PENDING_TO_CANCEL_REPLY)
    return 'no_pending_to_cancel'
  }

  return 'none'
}

export interface ReprocessDeletionInsertsResult {
  attempted: number
  recovered: number
  stillFailing: number
  gaveUp: number
}

/**
 * Reprocessing sweep for `data_deletion_insert_failures` rows — called
 * from /api/eter-agent/data-deletion-retries/cron (see
 * docs/eter-agent-config.md). Retries the `createDeletionRequest`
 * insert for each due row; on success the request now exists for real
 * in `data_deletion_requests` (or already did — `createDeletionRequest`
 * is itself idempotent per phone) and the queue row is marked
 * `recovered`. On repeated failure the row is requeued as `failed`
 * again, or given up on (`gave_up`, terminal, fresh alert) once
 * MAX_INSERT_RETRY_ATTEMPTS attempt groups have been spent on it —
 * mirrors reprocessFailedApprovalForwards in aisdr-approval-forward.ts.
 *
 * Each row's entire handling is wrapped so one row's unexpected
 * failure can never abort the sweep or skip the rest of the batch —
 * same pattern as every other cron sweep in this codebase.
 */
export async function reprocessFailedDataDeletionInserts(
  db: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<ReprocessDeletionInsertsResult> {
  const due = await getFailedDeletionInsertsForRetry(db, opts)
  let recovered = 0
  let stillFailing = 0
  let gaveUp = 0

  for (const row of due) {
    try {
      try {
        await createDeletionRequest(db, row.accountId, {
          conversationId: row.conversationId,
          contactId: row.contactId,
          phone: row.phone,
          profileName: row.profileName,
        })
        await markDeletionInsertRecovered(db, row.id)
        recovered++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const attempts = row.attempts + 1
        const giveUp = attempts >= MAX_INSERT_RETRY_ATTEMPTS
        await markDeletionInsertFailedAgain(db, row.id, attempts, message, { giveUp })
        if (giveUp) {
          gaveUp++
          console.error(
            `[data-deletion] pedido de eliminação para telefone=${row.phone} desistido após ` +
              `${attempts} tentativas — precisa de intervenção manual.`,
          )
        } else {
          stillFailing++
        }
        await sendWhatsAppAdminAlert(
          `${giveUp ? 'FALHA DEFINITIVA' : 'Falha'} a reprocessar pedido de eliminação RGPD. ` +
            `telefone=${row.phone} account_id=${row.accountId} tentativas=${attempts} erro: ${message}`,
          { accountId: row.accountId },
        ).catch((alertErr) =>
          console.error('[data-deletion] failed to send the reprocessing alert itself:', alertErr),
        )
      }
    } catch (err) {
      console.error('[data-deletion] erro irrecuperável a reprocessar linha', row.id, err)
      stillFailing++
    }
  }

  return { attempted: due.length, recovered, stillFailing, gaveUp }
}
