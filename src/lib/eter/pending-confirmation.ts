import type { SupabaseClient } from '@supabase/supabase-js'
import { getPendingActionForConversation, resolvePendingAction } from './repo/pending-actions.repo'
import type { PendingAction } from './repo/pending-actions.repo'
import { confirmPendingAction, rejectPendingAction, PendingActionError } from '../ai/tools/handlers/confirm-pending-action'
import { getBooking } from './repo/bookings.repo'
import { classifyConfirmationDeterministic } from './confirmation-classifier'
import { loadAiConfig } from '../ai/config'
import { generateReply } from '../ai/generate'
import { engineSendText } from '../automations/meta-send'
import { scheduleMeetingReminders, cancelFollowUpCadence } from './followups'
import { cancelRemindersForBooking } from './repo/scheduled-messages.repo'

// ============================================================
// Webhook-layer half of the write gate (see
// src/lib/ai/tools/write-gate.ts): detects an explicit "sim,
// confirmo" / "não, obrigado" reply to a pending calendar proposal and
// calls `confirmPendingAction` / `rejectPendingAction` — the only code
// path that is meant to call them. Never invoked from the model /
// tool-calling loop.
//
// Classification is two-tier:
//   1. Deterministic phrase match (confirmation-classifier.ts) — fast,
//      free, no ambiguity for the common cases.
//   2. LLM fallback for anything else, biased hard toward `other` —
//      wrongly confirming a booking the lead didn't want is worse than
//      asking again. Reuses the account's own configured AI provider
//      (loadAiConfig / generateReply) rather than a second API-call
//      path. If the account has no usable AI config, we can't ask an
//      LLM either — treat as `other` (never guess).
// ============================================================

export const SESSION_WINDOW_MS_FOR_EXPIRY = 24 * 60 * 60 * 1000

export type PendingConfirmationOutcome = 'none' | 'confirmed' | 'rejected' | 'other'

export interface HandlePendingConfirmationArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string | null
  /** Config-owner user id, used as the audit/sender-of-record for the
   *  reply this may send (same role `configOwnerUserId` plays
   *  everywhere else in the webhook route) and as the notify_admin
   *  fallback recipient when there's no other configured handoff
   *  agent to reach in this webhook-layer context. */
  userId: string
  inboundText: string
}

async function classifyWithLlmFallback(
  db: SupabaseClient,
  accountId: string,
  inboundText: string,
): Promise<'confirm' | 'reject' | 'other'> {
  const config = await loadAiConfig(db, accountId).catch(() => null)
  if (!config) return 'other'

  const systemPrompt =
    'Estás a classificar UMA mensagem de um lead do WhatsApp como resposta a uma proposta de reunião ' +
    'pendente de confirmação. Responde com EXATAMENTE uma palavra, em maiúsculas, sem mais nada: ' +
    'CONFIRM se a mensagem confirma claramente e sem ambiguidade a proposta; ' +
    'REJECT se a mensagem recusa claramente e sem ambiguidade a proposta; ' +
    'OTHER em qualquer outro caso, incluindo quando não tens a certeza, quando a mensagem é ambígua, ' +
    'quando pede outra coisa, ou quando não é claramente uma coisa nem outra. ' +
    'Confirmar uma reunião que o lead não quis é pior do que perguntar outra vez — na dúvida, responde OTHER.'

  try {
    const result = await generateReply({
      config,
      systemPrompt,
      messages: [{ role: 'user', content: inboundText }],
    })
    const word = result.text.trim().toUpperCase()
    if (word.startsWith('CONFIRM')) return 'confirm'
    if (word.startsWith('REJECT')) return 'reject'
    return 'other'
  } catch {
    // Network/provider failure — never let a flaky LLM call turn into
    // an accidental confirm/reject. Fall through to `other`, which
    // routes to the normal AI auto-reply path.
    return 'other'
  }
}

function formatBookingWhen(startsAt: Date): string {
  return startsAt.toLocaleString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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
    // Never let a failed reply throw out of the webhook — same
    // no-throw contract every other dispatch in the webhook route
    // follows (dispatchInboundToFlows, runAutomationsForTrigger, ...).
    console.error('[pending-confirmation] failed to send reply:', err)
  }
}

async function afterConfirmedBooking(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  pending: PendingAction,
  bookingId: string,
): Promise<void> {
  // A booking transitioning to confirmed cancels any pending quiet-lead
  // follow-ups for this conversation — the lead just engaged.
  await cancelFollowUpCadence(db, accountId, conversationId).catch((err) =>
    console.error('[pending-confirmation] failed to cancel follow-ups:', err),
  )

  if (pending.toolName === 'cancel_booking') {
    // The booking this pending action resolved is now cancelled — any
    // reminders queued for it are moot.
    await cancelRemindersForBooking(db, accountId, bookingId).catch((err) =>
      console.error('[pending-confirmation] failed to cancel reminders:', err),
    )
    return
  }

  // book_meeting / reschedule: (re)schedule the T-24h / T-2h reminders
  // against the resulting booking's current start time.
  const booking = await getBooking(db, accountId, bookingId)
  if (!booking || booking.status !== 'confirmed') return
  await scheduleMeetingReminders(db, accountId, booking).catch((err) =>
    console.error('[pending-confirmation] failed to schedule reminders:', err),
  )
}

/**
 * Entry point called from the WhatsApp webhook for every inbound text
 * message, before AI auto-reply dispatch. Returns 'none' immediately
 * (no-op) when the conversation has no pending proposal — the caller's
 * existing cascade (flows/automations/AI auto-reply) is otherwise
 * untouched.
 */
export async function handleInboundPendingConfirmation(
  args: HandlePendingConfirmationArgs,
): Promise<PendingConfirmationOutcome> {
  const { db, accountId, conversationId, contactId, userId, inboundText } = args

  const pending = await getPendingActionForConversation(db, accountId, conversationId)
  if (!pending) return 'none'

  const deterministic = classifyConfirmationDeterministic(inboundText)
  const classification =
    deterministic !== 'other' ? deterministic : await classifyWithLlmFallback(db, accountId, inboundText)

  if (classification === 'other') return 'other'

  if (classification === 'reject') {
    try {
      await rejectPendingAction(db, accountId, pending.id)
      await reply(
        accountId,
        userId,
        conversationId,
        contactId,
        'Sem problema, cancelei esse pedido. Qual seria a melhor altura para ti?',
      )
    } catch (err) {
      if (err instanceof PendingActionError) {
        // Already resolved by a concurrent call (e.g. duplicate webhook
        // delivery) — nothing more to do, and nothing to tell the lead
        // that isn't already true.
        console.warn('[pending-confirmation] reject on non-pending action:', err.code)
      } else {
        throw err
      }
    }
    return 'rejected'
  }

  // classification === 'confirm'
  const ageMs = Date.now() - pending.createdAt.getTime()
  if (ageMs > SESSION_WINDOW_MS_FOR_EXPIRY) {
    // Expiry is a webhook-layer policy call, not the write gate's job
    // (see confirm-pending-action.ts's own docstring) — resolve it
    // here as 'expired' rather than letting a stale proposal silently
    // get booked against a slot that may no longer be free.
    try {
      await resolvePendingAction(db, accountId, pending.id, { status: 'expired' })
    } catch (err) {
      console.warn('[pending-confirmation] failed to mark pending action expired:', err)
    }
    await reply(
      accountId,
      userId,
      conversationId,
      contactId,
      'Peço desculpa, essa proposta já passou de validade e esse horário pode já não estar livre — ' +
        'deixa-me verificar a disponibilidade outra vez e já te digo.',
    )
    return 'confirmed'
  }

  try {
    const { bookingId } = await confirmPendingAction(db, accountId, pending.id)
    await afterConfirmedBooking(db, accountId, conversationId, pending, bookingId)

    if (pending.toolName === 'cancel_booking') {
      await reply(accountId, userId, conversationId, contactId, 'Feito, a tua reunião foi cancelada.')
    } else {
      const booking = await getBooking(db, accountId, bookingId)
      const when = booking ? formatBookingWhen(booking.startsAt) : null
      await reply(
        accountId,
        userId,
        conversationId,
        contactId,
        when
          ? `Perfeito, está confirmado para ${when}! Até já.`
          : 'Perfeito, está confirmado! Até já.',
      )
    }
  } catch (err) {
    if (err instanceof PendingActionError) {
      const message =
        err.code === 'not_pending'
          ? 'Esse pedido já tinha sido tratado — se ainda precisares de agendar algo, diz-me.'
          : err.code === 'calendar_not_active'
            ? 'Peço desculpa, houve um problema com o calendário do nosso lado — já vou pedir a alguém da equipa para tratar disto.'
            : 'Peço desculpa, não consegui confirmar isso agora — já vou pedir a alguém da equipa para verificar.'
      console.error('[pending-confirmation] confirmPendingAction failed:', err.code, err.message)
      await reply(accountId, userId, conversationId, contactId, message)
    } else {
      throw err
    }
  }

  return 'confirmed'
}
