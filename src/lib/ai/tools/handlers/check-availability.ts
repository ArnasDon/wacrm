import { getCalendarConfig } from '@/lib/eter/repo/calendar-config.repo'
import { findConfirmedBookingsInRange } from '@/lib/eter/repo/bookings.repo'
import { calculateAvailability } from '@/lib/calendar/google/availability'
import { createAccountCalendarClient } from '@/lib/calendar/google/account-client'
import type { BusyInterval } from '@/lib/calendar/google/client'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireIsoDate, optionalInteger, ToolInputError } from './parse-input'

/** Hard cap on the span between range_start/range_end. `range_start` /
 *  `range_end` are model-supplied and ultimately attacker-influenced —
 *  a WhatsApp lead can steer the model into asking for an absurdly wide
 *  range (e.g. decades), and `calculateAvailability`'s day-by-day loop
 *  (availability.ts) scales linearly with the span. This bounds the
 *  worst case to a bounded number of iterations per tool call rather
 *  than trusting the model to only ever ask for something reasonable. */
const MAX_RANGE_DAYS = 90

/**
 * check_availability — list free slots within a resolved date range.
 *
 * Combines two sources of "busy" so the agent never offers a slot
 * that's actually taken: Google's own `freeBusy` (covers events not
 * created by this agent — a human manually blocked time, another app
 * wrote to the same calendar) AND this account's own `confirmed`
 * bookings (covers a booking whose Google event write raced or
 * hasn't propagated yet — defense in depth, not redundant).
 */
export async function checkAvailabilityHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const rangeStart = requireIsoDate(input, 'range_start')
    const rangeEnd = requireIsoDate(input, 'range_end')
    if (rangeEnd <= rangeStart) {
      return { isError: true, content: '"range_end" tem de ser depois de "range_start".' }
    }
    const rangeDays = (rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)
    if (rangeDays > MAX_RANGE_DAYS) {
      return {
        isError: true,
        content: `O intervalo pedido é demasiado grande (máximo ${MAX_RANGE_DAYS} dias). Pede ao lead para escolher um período mais curto.`,
      }
    }

    const config = await getCalendarConfig(ctx.db, ctx.accountId)
    if (!config || !config.isActive) {
      return {
        isError: true,
        content: 'Não há um calendário Google ligado e activo para esta conta.',
      }
    }

    const durationMin = optionalInteger(input, 'duration_min') ?? config.defaultDurationMin

    const [googleBusy, confirmedBookings] = await Promise.all([
      createAccountCalendarClient(config).then((client) =>
        client.getBusySlots({ start: rangeStart, end: rangeEnd }),
      ),
      findConfirmedBookingsInRange(ctx.db, ctx.accountId, rangeStart, rangeEnd),
    ])

    const bookingsBusy: BusyInterval[] = confirmedBookings.map((b) => ({
      start: b.startsAt,
      end: b.endsAt,
    }))

    const slots = calculateAvailability(
      {
        timezone: config.timezone,
        businessHours: config.businessHours,
        bufferMin: config.bufferMin,
        minLeadTimeMin: config.minLeadTimeMin,
      },
      { start: rangeStart, end: rangeEnd },
      durationMin,
      [...googleBusy, ...bookingsBusy],
    )

    return {
      isError: false,
      content: JSON.stringify({
        timezone: config.timezone,
        duration_min: durationMin,
        slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
      }),
    }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}
