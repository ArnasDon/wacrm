import type { SupabaseClient } from '@supabase/supabase-js'
import { getCalendarConfig, updateCalendarConfigRefreshToken } from '@/lib/eter/repo/calendar-config.repo'
import { createBooking, getBooking, updateBooking } from '@/lib/eter/repo/bookings.repo'
import {
  attachResultingBooking,
  resolvePendingAction,
  type PendingAction,
} from '@/lib/eter/repo/pending-actions.repo'
import { createAccountCalendarClient } from '@/lib/calendar/google/account-client'
import { requireString, requireIsoDate, optionalString, ToolInputError } from './parse-input'

// ============================================================
// The OTHER half of the write gate (see tools/write-gate.ts). This is
// the only code path allowed to actually mutate Google Calendar /
// `bookings` for the three gated tools. It is NOT part of the tool
// loop and the model can never invoke it directly — it's meant to be
// called by product code (the WhatsApp inbound webhook, or an admin
// action) once the lead's explicit confirmation has been detected in a
// later message.
//
// Wiring the *detection* side (classifying "sim, confirmo" /
// "não, obrigado" in an inbound WhatsApp message and calling this
// function) is a webhook-layer concern outside src/lib/ai — it belongs
// wherever the inbound message handler already lives, and is not part
// of this pass; see the Fase 2 report for what's left.
//
// Concurrency: `resolvePendingAction`'s `.eq('status', 'pending')`
// filter is the atomic CLAIM — it is called FIRST, before any calendar
// mutation, and its own updated row (still carrying `toolInput`) is
// what the rest of this function acts on. Two concurrent calls for the
// same `pendingActionId` (a duplicate webhook delivery, a retried admin
// click) can therefore never both pass the claim: only one gets the
// row back, the other throws immediately from
// `resolvePendingAction`'s `.single()` finding no match — well before
// either would reach Google Calendar. This was a real gap in an
// earlier draft (read-then-act, not claim-then-act) caught in review;
// don't reorder it back.
// ============================================================

export class PendingActionError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'PendingActionError'
    this.code = code
  }
}

type ParsedInput =
  | {
      tool: 'book_meeting'
      contactId: string
      startsAt: Date
      endsAt: Date
      service?: string
      notes?: string
    }
  | { tool: 'reschedule'; bookingId: string; newStartsAt: Date; newEndsAt: Date }
  | { tool: 'cancel_booking'; bookingId: string }

/**
 * `toolInput` was written by the (validated) propose-write.ts path, but
 * this function must not trust that blindly — a stale row from a
 * manual DB edit, a future handler that forgets to validate, or a
 * migration backfill could all leave malformed data here. Re-parse with
 * the same helpers the tool handlers use, so a bad row fails with a
 * clean `PendingActionError` instead of `new Date(undefined)` silently
 * becoming an `Invalid Date` that gets persisted. Returns a tagged
 * union (discriminated on `tool`) so callers `switch` on it directly
 * instead of casting.
 */
function parseToolInput(action: PendingAction): ParsedInput {
  try {
    switch (action.toolName) {
      case 'book_meeting':
        return {
          tool: 'book_meeting',
          contactId: requireString(action.toolInput, 'contact_id'),
          startsAt: requireIsoDate(action.toolInput, 'starts_at'),
          endsAt: requireIsoDate(action.toolInput, 'ends_at'),
          service: optionalString(action.toolInput, 'service'),
          notes: optionalString(action.toolInput, 'notes'),
        }
      case 'reschedule':
        return {
          tool: 'reschedule',
          bookingId: requireString(action.toolInput, 'booking_id'),
          newStartsAt: requireIsoDate(action.toolInput, 'new_starts_at'),
          newEndsAt: requireIsoDate(action.toolInput, 'new_ends_at'),
        }
      case 'cancel_booking':
        return { tool: 'cancel_booking', bookingId: requireString(action.toolInput, 'booking_id') }
    }
  } catch (err) {
    if (err instanceof ToolInputError) {
      throw new PendingActionError(
        `Pending action ${action.id} has invalid tool_input: ${err.message}`,
        'invalid_pending_input',
      )
    }
    throw err
  }
}

/** Confirm a pending proposal: atomically claim it, then perform the
 *  real Google Calendar mutation and write/patch the `bookings` row.
 *  Throws `PendingActionError` for anything that should stop the
 *  confirmation outright (no longer pending — already claimed/resolved
 *  by a concurrent call, missing calendar config, booking not found,
 *  or a corrupt `tool_input`) — callers should catch this and tell the
 *  lead something went wrong rather than silently doing nothing. */
export async function confirmPendingAction(
  db: SupabaseClient,
  accountId: string,
  pendingActionId: string,
): Promise<{ bookingId: string }> {
  // Atomic claim FIRST — see the concurrency note in the module header.
  // `resultingBookingId` is unknown at this point (nothing's been
  // created yet); `attachResultingBooking` fills it in once it exists.
  let claimed: PendingAction
  try {
    claimed = await resolvePendingAction(db, accountId, pendingActionId, {
      status: 'confirmed',
      resultingBookingId: null,
    })
  } catch {
    throw new PendingActionError(
      `No pending action ${pendingActionId} to confirm for account ${accountId} (already resolved, or never existed).`,
      'not_pending',
    )
  }

  const config = await getCalendarConfig(db, accountId)
  if (!config || !config.isActive) {
    throw new PendingActionError(
      `Calendar is not configured/active for account ${accountId}.`,
      'calendar_not_active',
    )
  }

  const calendar = await createAccountCalendarClient(config)
  // Google rarely rotates the refresh token on exchange, but when it
  // does, persist it immediately — otherwise every subsequent refresh
  // for this account fails.
  if (calendar.rotatedRefreshToken) {
    await updateCalendarConfigRefreshToken(db, accountId, calendar.rotatedRefreshToken)
  }

  const input = parseToolInput(claimed)

  switch (input.tool) {
    case 'book_meeting': {
      const { contactId, startsAt, endsAt, service, notes } = input
      const event = await calendar.createEvent({
        summary: service || 'Reunião',
        description: notes,
        start: startsAt,
        end: endsAt,
      })
      const booking = await createBooking(db, accountId, {
        contactId: contactId ?? claimed.contactId,
        conversationId: claimed.conversationId,
        startsAt,
        endsAt,
        status: 'confirmed',
        service: service ?? null,
        notes: notes ?? null,
        externalEventId: event.id,
      })
      await attachResultingBooking(db, accountId, pendingActionId, booking.id)
      return { bookingId: booking.id }
    }

    case 'reschedule': {
      const { bookingId, newStartsAt, newEndsAt } = input
      const existing = await getBooking(db, accountId, bookingId)
      if (!existing) {
        throw new PendingActionError(`Booking ${bookingId} not found for account ${accountId}.`, 'booking_not_found')
      }

      if (existing.externalEventId) {
        await calendar.updateEvent(existing.externalEventId, {
          summary: existing.service || 'Reunião',
          description: existing.notes || undefined,
          start: newStartsAt,
          end: newEndsAt,
        })
      }

      const updated = await updateBooking(db, accountId, bookingId, {
        startsAt: newStartsAt,
        endsAt: newEndsAt,
        status: 'confirmed',
      })
      await attachResultingBooking(db, accountId, pendingActionId, updated.id)
      return { bookingId: updated.id }
    }

    case 'cancel_booking': {
      const { bookingId } = input
      const existing = await getBooking(db, accountId, bookingId)
      if (!existing) {
        throw new PendingActionError(`Booking ${bookingId} not found for account ${accountId}.`, 'booking_not_found')
      }
      if (existing.externalEventId) {
        await calendar.deleteEvent(existing.externalEventId)
      }
      const updated = await updateBooking(db, accountId, bookingId, { status: 'cancelled' })
      await attachResultingBooking(db, accountId, pendingActionId, updated.id)
      return { bookingId: updated.id }
    }
  }
}

/** Reject a pending proposal without touching the calendar — e.g. the
 *  lead said "não, obrigado" or asked for something else instead. Also
 *  atomic via the same `.eq('status', 'pending')` claim, so this can't
 *  race a concurrent `confirmPendingAction` either. */
export async function rejectPendingAction(
  db: SupabaseClient,
  accountId: string,
  pendingActionId: string,
): Promise<void> {
  await resolvePendingAction(db, accountId, pendingActionId, { status: 'rejected' })
}
