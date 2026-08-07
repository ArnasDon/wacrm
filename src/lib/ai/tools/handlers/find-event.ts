import { findBookings, type BookingStatus } from '@/lib/eter/repo/bookings.repo'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { optionalString, optionalIsoDate, optionalEnum, ToolInputError } from './parse-input'

const STATUSES: readonly BookingStatus[] = ['proposed', 'confirmed', 'cancelled', 'no_show']

/**
 * find_event — locate existing bookings for this contact/conversation.
 * Falls back to the current conversation/contact from context when the
 * model doesn't supply one (it usually won't need to, since it's
 * already inside that thread) — but an explicit argument always wins.
 */
export async function findEventHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const contactId = optionalString(input, 'contact_id') ?? ctx.contactId ?? undefined
    const conversationId = optionalString(input, 'conversation_id') ?? ctx.conversationId ?? undefined
    const rangeStart = optionalIsoDate(input, 'range_start')
    const rangeEnd = optionalIsoDate(input, 'range_end')
    const status = optionalEnum(input, 'status', STATUSES)

    const bookings = await findBookings(ctx.db, ctx.accountId, {
      contactId,
      conversationId,
      rangeStart,
      rangeEnd,
      status: status ? [status] : undefined,
    })

    return {
      isError: false,
      content: JSON.stringify(
        bookings.map((b) => ({
          booking_id: b.id,
          starts_at: b.startsAt.toISOString(),
          ends_at: b.endsAt.toISOString(),
          status: b.status,
          service: b.service,
          notes: b.notes,
        })),
      ),
    }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}
