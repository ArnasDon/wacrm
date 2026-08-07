import { getBooking } from '@/lib/eter/repo/bookings.repo'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, requireIsoDate, optionalString, ToolInputError } from './parse-input'
import { proposeWriteAction } from './propose-write'

/** reschedule — WRITE-GATED (see write-gate.ts). Validates the booking
 *  actually exists for this account before proposing (fail fast on a
 *  bad id, rather than letting a confirmation later resolve against
 *  nothing), but only ever creates a pending proposal — the real
 *  Google Calendar update happens in `confirmPendingAction`. */
export async function rescheduleHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const bookingId = requireString(input, 'booking_id')
    const newStartsAt = requireIsoDate(input, 'new_starts_at')
    const newEndsAt = requireIsoDate(input, 'new_ends_at')
    if (newEndsAt <= newStartsAt) {
      return { isError: true, content: '"new_ends_at" tem de ser depois de "new_starts_at".' }
    }

    const booking = await getBooking(ctx.db, ctx.accountId, bookingId)
    if (!booking) {
      return { isError: true, content: `Não encontrei nenhuma reserva com o id "${bookingId}".` }
    }
    if (booking.status === 'cancelled') {
      return { isError: true, content: 'Essa reserva já está cancelada — não pode ser remarcada.' }
    }

    return proposeWriteAction(
      ctx,
      'reschedule',
      {
        booking_id: bookingId,
        new_starts_at: newStartsAt.toISOString(),
        new_ends_at: newEndsAt.toISOString(),
        reason: optionalString(input, 'reason'),
      },
      `remarcar reunião existente para ${newStartsAt.toISOString()}`,
    )
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}
