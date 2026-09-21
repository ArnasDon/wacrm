import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, addMinutes, startOfDay } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import {
  createEvent,
  getFreeBusyForCalendars,
  GOOGLE_CALENDAR_OAUTH_SCOPES,
  type BusyInterval,
  type HttpClient,
} from './google/client'
import {
  commercialImpersonatedUserFromEnv,
  getServiceAccountAccessToken,
  loadServiceAccountFromEnv,
} from './google/service-account'
import { calculateAvailability, type AvailabilitySlot } from './google/availability'
import {
  getCommercialCalendarConfig,
  type CommercialCalendarConfig,
} from '@/lib/eter/repo/commercial-calendar-config.repo'
import { createBooking, findConfirmedBookingsInRange } from '@/lib/eter/repo/bookings.repo'

// ============================================================
// Bloco 3-A — real scheduling for the commercial persona.
//
// The commercial agent proposes CONCRETE times (never "when suits
// you?") and, once the lead picks one, books it directly — but a slot
// is only ever offered/booked when it's free across EVERY calendar in
// `commercial_busy_calendar_ids` (Ricardo's own calendar included), and
// the event itself is always created on the dedicated leads calendar
// (`commercial_calendar_id`), never on a personal one.
//
// Auth: a single Google service account with domain-wide delegation,
// impersonating geral@etergrowth.com (service-account.ts) — NOT the
// per-account OAuth flow the personal `check_availability`/
// `book_meeting` tools use (account-client.ts), which is a different
// calendar-ownership model entirely.
// ============================================================

/** Cap on how many concrete slots the agent proposes at once — the
 *  prompt asks for "two or three", this is the hard ceiling regardless
 *  of what the model requests. */
export const MAX_PROPOSED_SLOTS = 3

const CALENDAR_SCOPE = GOOGLE_CALENDAR_OAUTH_SCOPES.join(' ')

export class CommercialCalendarNotConfiguredError extends Error {
  constructor() {
    super('commercial_calendar_id is not configured for this account.')
    this.name = 'CommercialCalendarNotConfiguredError'
  }
}

/**
 * Advance `n` BUSINESS days (Mon–Sun, skipping Sat/Sun) from `from`, in
 * `timezone`'s calendar-day sense. Used to bound the proposal window at
 * "N business days ahead" rather than N calendar days, which would
 * under-count actual availability whenever the window spans a weekend.
 */
export function addBusinessDays(from: Date, n: number, timezone: string): Date {
  let cursor = new TZDate(from.getTime(), timezone)
  let remaining = n
  while (remaining > 0) {
    cursor = addDays(cursor, 1)
    const weekday = cursor.getDay() // 0 = Sun, 6 = Sat
    if (weekday !== 0 && weekday !== 6) remaining -= 1
  }
  return cursor
}

/**
 * Advance `minutes` from `from`, but weekend time doesn't count towards
 * the total — Sat/Sun are skipped in full rather than consumed. This is
 * what makes `commercial_min_lead_time_min` mean "N business days"
 * instead of "N calendar days": with a plain `addMinutes`, 2880 min (48h)
 * requested on a Friday afternoon would land on a Sunday, and the very
 * first slot offered would be Monday morning — one business day away,
 * not two, which is not what the lead-time setting is meant to guarantee
 * (Ricardo, 21/09/2026: never propose the same day nor the next one;
 * always 2–3 business days out).
 *
 * Each business day is treated as a full midnight-to-midnight span for
 * this purpose (not "business hours only") — `calculateAvailability`
 * still clips the result against `businessHours` afterwards, so this
 * only needs to get the DAY right, not the hour-of-day boundary.
 */
export function addBusinessMinutes(from: Date, minutes: number, timezone: string): Date {
  let cursor: Date = new TZDate(from.getTime(), timezone)
  let remaining = minutes
  while (remaining > 0) {
    const weekday = cursor.getDay() // 0 = Sun, 6 = Sat
    const startOfNextDay = startOfDay(addDays(cursor, 1))
    if (weekday === 0 || weekday === 6) {
      // Weekend: skip straight to the next calendar day without
      // consuming any of `remaining`.
      cursor = startOfNextDay
      continue
    }
    const minutesToNextDay = (startOfNextDay.getTime() - cursor.getTime()) / 60_000
    if (remaining <= minutesToNextDay) {
      cursor = addMinutes(cursor, remaining)
      remaining = 0
    } else {
      cursor = startOfNextDay
      remaining -= minutesToNextDay
    }
  }
  return cursor
}

async function commercialAccessToken(http?: HttpClient): Promise<string> {
  const sa = loadServiceAccountFromEnv()
  const subject = commercialImpersonatedUserFromEnv()
  return getServiceAccountAccessToken(sa, { scope: CALENDAR_SCOPE, subject }, http)
}

/**
 * Merge busy intervals from every calendar in the list into one flat,
 * unsorted array — a slot must be free in ALL of them, which is
 * equivalent to treating "busy in any one of them" as busy overall.
 * `calculateAvailability` already merges/sorts/pads internally, so a
 * flat concat is all that's needed here.
 */
function flattenBusy(byCalendar: Record<string, BusyInterval[]>): BusyInterval[] {
  return Object.values(byCalendar).flat()
}

export interface FindSlotsResult {
  config: CommercialCalendarConfig
  slots: AvailabilitySlot[]
}

/**
 * Compute up to `MAX_PROPOSED_SLOTS` concrete, currently-free meeting
 * slots for the account's commercial calendar, honouring its
 * scheduling rules (duration, business hours, timezone, min lead time,
 * buffer, and the business-days-ahead window).
 *
 * Throws `CommercialCalendarNotConfiguredError` when the account hasn't
 * set a `commercial_calendar_id` — callers (the tool handler) turn that
 * into a clean tool-error message rather than a raw exception reaching
 * the model.
 */
export async function findCommercialSlots(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
  http?: HttpClient,
): Promise<FindSlotsResult> {
  const config = await getCommercialCalendarConfig(db, accountId)
  if (!config || !config.calendarId) {
    throw new CommercialCalendarNotConfiguredError()
  }

  const rangeStart = now
  const rangeEnd = addBusinessDays(now, config.maxBusinessDaysAhead, config.timezone)

  const accessToken = await commercialAccessToken(http)
  const [busyByCalendar, confirmedBookings] = await Promise.all([
    getFreeBusyForCalendars(accessToken, config.busyCalendarIds, { start: rangeStart, end: rangeEnd }, http),
    findConfirmedBookingsInRange(db, accountId, rangeStart, rangeEnd),
  ])

  const busy = [
    ...flattenBusy(busyByCalendar),
    ...confirmedBookings.map((b) => ({ start: b.startsAt, end: b.endsAt })),
  ]

  // The lead-time floor is computed here (business-days-aware) and
  // handed to `calculateAvailability` as its `now` with `minLeadTimeMin:
  // 0` — that function's own lead-time handling is a plain `addMinutes`
  // shared with the PERSONAL calendar's `check_availability`, which must
  // keep its calendar-days-are-equal behaviour untouched. See
  // `addBusinessMinutes` above.
  const earliestBookable = addBusinessMinutes(now, config.minLeadTimeMin, config.timezone)
  const allSlots = calculateAvailability(
    {
      timezone: config.timezone,
      businessHours: config.businessHours,
      bufferMin: config.bufferMin,
      minLeadTimeMin: 0,
    },
    { start: rangeStart, end: rangeEnd },
    config.meetingDurationMin,
    busy,
    earliestBookable,
  )

  return { config, slots: allSlots.slice(0, MAX_PROPOSED_SLOTS) }
}

/** True when `slot` is still free across every calendar in
 *  `busyByCalendar` — the re-check `bookCommercialSlot` runs
 *  immediately before writing, to close the race between "the agent
 *  proposed this slot" and "the lead confirmed it" (someone else could
 *  have taken it in between, on any of the checked calendars). */
function slotStillFree(
  slot: { start: Date; end: Date },
  busyByCalendar: Record<string, BusyInterval[]>,
): boolean {
  for (const busyList of Object.values(busyByCalendar)) {
    for (const b of busyList) {
      if (slot.start < b.end && b.start < slot.end) return false
    }
  }
  return true
}

export interface BookCommercialSlotInput {
  accountId: string
  contactId: string | null
  conversationId: string | null
  leadEmail: string
  leadName?: string | null
  /** `contacts.company` — drives the event TITLE (Ricardo, 21/09/2026):
   *  "Reunião [Empresa]<>Eter Growth". When empty (e.g. an independent
   *  worker with no company name on file), the title falls back to
   *  `leadName` instead — see `buildEventTitle` below. */
  company?: string | null
  /** `contacts.phone` — shown in the event description so Ricardo can
   *  see who he's meeting without opening EterWA. */
  leadPhone?: string | null
  /** `conversations.escalation_reason` — the reason/context for the
   *  contact, also surfaced in the event description. */
  reason?: string | null
  /** Only the start is caller-supplied — the end is always derived from
   *  the account's own `commercial_meeting_duration_min`, so a tool
   *  call can never book a longer/shorter meeting than the configured
   *  rule allows. */
  start: Date
}

/** "Reunião [Empresa]<>Eter Growth" — no spaces around `<>` (Ricardo,
 *  21/09/2026). Falls back to the lead's own name when there's no
 *  company on file (independent workers), and finally to a generic
 *  label when neither is known — `book_commercial_meeting`'s own gate
 *  (commercial.ts) normally guarantees `company` is set before this is
 *  ever called, but this function doesn't assume its caller enforced
 *  that. */
function buildEventTitle(company: string | null | undefined, leadName: string | null | undefined): string {
  const who = (company && company.trim()) || (leadName && leadName.trim()) || 'lead (anúncio)'
  return `Reunião ${who}<>Eter Growth`
}

/** Description for the calendar event — everything Ricardo needs to
 *  know who he's meeting and why, without opening EterWA (Ricardo,
 *  21/09/2026). Omits a field entirely when unknown rather than
 *  printing an empty "Telefone: " line. */
function buildEventDescription(input: {
  leadName?: string | null
  leadPhone?: string | null
  leadEmail: string
  reason?: string | null
}): string {
  const lines = ['Marcado automaticamente pelo assistente comercial (Bloco 3-A).', '']
  if (input.leadName?.trim()) lines.push(`Nome: ${input.leadName.trim()}`)
  if (input.leadPhone?.trim()) lines.push(`Telefone: ${input.leadPhone.trim()}`)
  lines.push(`Email: ${input.leadEmail}`)
  if (input.reason?.trim()) lines.push(`Motivo: ${input.reason.trim()}`)
  return lines.join('\n')
}

export type BookCommercialSlotOutcome =
  | { status: 'booked'; eventId: string; htmlLink: string | null }
  | { status: 'conflict' }
  | { status: 'not_configured' }

/**
 * Re-validate `[start, end)` is still free across every busy calendar,
 * then create the event on the commercial leads calendar (with the
 * lead's email as an attendee, so Google emails them the invite) and
 * record it in `bookings` (status `confirmed`, same table/lifecycle the
 * personal `book_meeting` tool uses — see migration 037). Never throws
 * for the expected "someone got there first" race: returns
 * `{ status: 'conflict' }` so the caller can have the model propose
 * again instead of crashing the turn.
 */
export async function bookCommercialSlot(
  db: SupabaseClient,
  input: BookCommercialSlotInput,
  http?: HttpClient,
): Promise<BookCommercialSlotOutcome> {
  const config = await getCommercialCalendarConfig(db, input.accountId)
  if (!config || !config.calendarId) return { status: 'not_configured' }

  const end = new Date(input.start.getTime() + config.meetingDurationMin * 60_000)
  const accessToken = await commercialAccessToken(http)

  const busyByCalendar = await getFreeBusyForCalendars(
    accessToken,
    config.busyCalendarIds,
    { start: input.start, end },
    http,
  )
  if (!slotStillFree({ start: input.start, end }, busyByCalendar)) {
    return { status: 'conflict' }
  }
  // Defense in depth against a booking this app itself just confirmed
  // but that hasn't propagated to Google's freeBusy yet (eventual
  // consistency) — mirrors checkAvailabilityHandler's own double-source
  // check.
  const overlapping = await findConfirmedBookingsInRange(db, input.accountId, input.start, end)
  if (overlapping.some((b) => input.start < b.endsAt && b.startsAt < end)) {
    return { status: 'conflict' }
  }

  const event = await createEvent(
    accessToken,
    config.calendarId,
    {
      summary: buildEventTitle(input.company, input.leadName),
      description: buildEventDescription(input),
      start: input.start,
      end,
      timezone: config.timezone,
      attendeeEmails: [input.leadEmail],
    },
    http,
  )

  await createBooking(db, input.accountId, {
    contactId: input.contactId,
    conversationId: input.conversationId,
    startsAt: input.start,
    endsAt: end,
    status: 'confirmed',
    service: 'Bloco 3-A — lead de anúncio',
    externalEventId: event.id,
  })

  return { status: 'booked', eventId: event.id, htmlLink: event.htmlLink }
}
