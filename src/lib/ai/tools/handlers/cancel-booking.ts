import { getBooking } from '@/lib/eter/repo/bookings.repo'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, optionalString, ToolInputError } from './parse-input'
import { proposeWriteAction } from './propose-write'

/** cancel_booking — WRITE-GATED (see write-gate.ts). Only ever creates
 *  a pending proposal; the Google Calendar delete + `bookings.status =
 *  cancelled` happen in `confirmPendingAction` after explicit lead
 *  confirmation. */
export async function cancelBookingHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const bookingId = requireString(input, 'booking_id')

    const booking = await getBooking(ctx.db, ctx.accountId, bookingId)
    if (!booking) {
      return { isError: true, content: `Não encontrei nenhuma reserva com o id "${bookingId}".` }
    }
    if (booking.status === 'cancelled') {
      return { isError: true, content: 'Essa reserva já está cancelada.' }
    }

    return proposeWriteAction(
      ctx,
      'cancel_booking',
      { booking_id: bookingId, reason: optionalString(input, 'reason') },
      `cancelar reunião de ${booking.startsAt.toISOString()}`,
    )
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}
