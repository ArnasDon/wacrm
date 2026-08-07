import { getBooking } from '@/lib/eter/repo/bookings.repo'
import { cancelRemindersForBooking, scheduleMessages } from '@/lib/eter/repo/scheduled-messages.repo'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, requireIsoDate, ToolInputError } from './parse-input'

/**
 * send_reminder — schedules a reminder against `agent_scheduled_messages`
 * (migration 039), drained by `/api/eter-agent/cron`. Executes
 * directly (not write-gated): it queues a future WhatsApp send, it
 * doesn't mutate the calendar or `bookings`, so the write-gate
 * rationale in write-gate.ts doesn't apply here.
 *
 * The tool schema only takes `booking_id` + `send_at` (plus optional
 * `channel`/`message_template`, see schema.ts) — the DB's
 * `agent_scheduled_messages.kind` enum only has two reminder buckets
 * (`reminder_24h` / `reminder_2h`, the ones the automatic
 * T-24h/T-2h scheduling in followups.ts also uses, so the cron sweep's
 * out-of-window template lookup — `eter_reminder_24h` /
 * `eter_reminder_2h` — stays a single, predictable naming convention
 * regardless of who scheduled the row). A model-requested `send_at`
 * doesn't necessarily land on either offset exactly, so this picks
 * whichever bucket `send_at` is closer to (by absolute distance to
 * `starts_at - 24h` vs `starts_at - 2h`) — a documented heuristic, not
 * an exact mapping. `message_template` is accepted for schema
 * compatibility but not used to override the cron's naming convention
 * — the account has to actually have `eter_reminder_24h`/`_2h`
 * APPROVED for an out-of-window send to go out at all.
 */
export async function sendReminderHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const bookingId = requireString(input, 'booking_id')
    const sendAt = requireIsoDate(input, 'send_at')

    const booking = await getBooking(ctx.db, ctx.accountId, bookingId)
    if (!booking) {
      return { isError: true, content: `Não encontrei a reserva ${bookingId} para esta conta.` }
    }
    if (sendAt.getTime() <= Date.now()) {
      return { isError: true, content: 'send_at tem de ser uma data no futuro.' }
    }

    const distanceTo24h = Math.abs(sendAt.getTime() - (booking.startsAt.getTime() - 24 * 60 * 60 * 1000))
    const distanceTo2h = Math.abs(sendAt.getTime() - (booking.startsAt.getTime() - 2 * 60 * 60 * 1000))
    const kind = distanceTo24h <= distanceTo2h ? 'reminder_24h' : 'reminder_2h'

    // Replace any existing pending reminder of the SAME bucket for this
    // booking — matches the cancel-then-insert idempotency pattern the
    // automatic scheduling (followups.ts) also follows, so a model
    // that calls send_reminder twice for the same booking doesn't hit
    // the partial unique index in migration 039.
    await cancelRemindersForBooking(ctx.db, ctx.accountId, booking.id, { kinds: [kind] })
    await scheduleMessages(ctx.db, ctx.accountId, [
      {
        conversationId: booking.conversationId,
        contactId: booking.contactId,
        bookingId: booking.id,
        kind,
        sendAt,
        payload: {
          freeText: `Lembrete: tens uma reunião marcada. Até já!`,
        },
      },
    ])

    return {
      isError: false,
      content: `Lembrete agendado para ${sendAt.toISOString()}.`,
    }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}
