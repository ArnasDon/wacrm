import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// bookings repository — the ONLY module allowed to call
// `supabase.from('bookings')`. Every function takes `accountId` as its
// first explicit argument and filters on it — the tool-executor path
// runs under the service-role client (no RLS), so this filter is the
// entire cross-account boundary for meeting data. Never drop it, and
// never accept a `bookingId` without also checking it belongs to the
// given account (see `getBooking` / `updateBookingStatus` below).
// ============================================================

export type BookingStatus = 'proposed' | 'confirmed' | 'cancelled' | 'no_show'

export interface Booking {
  id: string
  accountId: string
  contactId: string | null
  conversationId: string | null
  externalEventId: string | null
  startsAt: Date
  endsAt: Date
  status: BookingStatus
  service: string | null
  notes: string | null
}

export interface CreateBookingInput {
  contactId?: string | null
  conversationId?: string | null
  startsAt: Date
  endsAt: Date
  status?: BookingStatus
  service?: string | null
  notes?: string | null
  externalEventId?: string | null
}

interface BookingRow {
  id: string
  account_id: string
  contact_id: string | null
  conversation_id: string | null
  external_event_id: string | null
  starts_at: string
  ends_at: string
  status: BookingStatus
  service: string | null
  notes: string | null
}

const COLUMNS =
  'id, account_id, contact_id, conversation_id, external_event_id, starts_at, ends_at, status, service, notes'

function toDomain(row: BookingRow): Booking {
  return {
    id: row.id,
    accountId: row.account_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    externalEventId: row.external_event_id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    status: row.status,
    service: row.service,
    notes: row.notes,
  }
}

export async function createBooking(
  db: SupabaseClient,
  accountId: string,
  input: CreateBookingInput,
): Promise<Booking> {
  const { data, error } = await db
    .from('bookings')
    .insert({
      account_id: accountId,
      contact_id: input.contactId ?? null,
      conversation_id: input.conversationId ?? null,
      external_event_id: input.externalEventId ?? null,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      status: input.status ?? 'proposed',
      service: input.service ?? null,
      notes: input.notes ?? null,
    })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return toDomain(data as BookingRow)
}

/** Fetch a single booking, scoped to the account — returns `null` (not
 *  an error) both when the id doesn't exist and when it belongs to a
 *  different account, so callers can't distinguish the two and probe
 *  for other accounts' booking ids. */
export async function getBooking(
  db: SupabaseClient,
  accountId: string,
  bookingId: string,
): Promise<Booking | null> {
  const { data, error } = await db
    .from('bookings')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as BookingRow)
}

export interface FindBookingsFilter {
  contactId?: string
  conversationId?: string
  rangeStart?: Date
  rangeEnd?: Date
  /** Defaults to `['proposed', 'confirmed']` — the two "live" states —
   *  when omitted, matching the tool schema's documented default. */
  status?: BookingStatus[]
}

export async function findBookings(
  db: SupabaseClient,
  accountId: string,
  filter: FindBookingsFilter = {},
): Promise<Booking[]> {
  let query = db.from('bookings').select(COLUMNS).eq('account_id', accountId)

  if (filter.contactId) query = query.eq('contact_id', filter.contactId)
  if (filter.conversationId) query = query.eq('conversation_id', filter.conversationId)
  if (filter.rangeStart) query = query.gte('starts_at', filter.rangeStart.toISOString())
  if (filter.rangeEnd) query = query.lte('starts_at', filter.rangeEnd.toISOString())
  query = query.in('status', filter.status ?? ['proposed', 'confirmed'])
  query = query.order('starts_at', { ascending: true })

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as BookingRow[]).map(toDomain)
}

/**
 * List confirmed bookings overlapping `[rangeStart, rangeEnd)` — the
 * input `calculateAvailability` (src/lib/calendar/google/availability.ts)
 * subtracts from the account's business hours. Only `confirmed` blocks
 * a slot; a merely `proposed` booking has not actually claimed the
 * calendar yet.
 */
export async function findConfirmedBookingsInRange(
  db: SupabaseClient,
  accountId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<Booking[]> {
  const { data, error } = await db
    .from('bookings')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('status', 'confirmed')
    .lt('starts_at', rangeEnd.toISOString())
    .gt('ends_at', rangeStart.toISOString())
    .order('starts_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as BookingRow[]).map(toDomain)
}

export interface UpdateBookingInput {
  startsAt?: Date
  endsAt?: Date
  status?: BookingStatus
  externalEventId?: string | null
  notes?: string | null
}

/** Update a booking, scoped to the account. Throws if the id doesn't
 *  resolve within this account (distinguishable from "not found" by
 *  callers that already confirmed existence via `getBooking`). */
export async function updateBooking(
  db: SupabaseClient,
  accountId: string,
  bookingId: string,
  input: UpdateBookingInput,
): Promise<Booking> {
  const patch: Record<string, unknown> = {}
  if (input.startsAt) patch.starts_at = input.startsAt.toISOString()
  if (input.endsAt) patch.ends_at = input.endsAt.toISOString()
  if (input.status) patch.status = input.status
  if (input.externalEventId !== undefined) patch.external_event_id = input.externalEventId
  if (input.notes !== undefined) patch.notes = input.notes

  const { data, error } = await db
    .from('bookings')
    .update(patch)
    .eq('account_id', accountId)
    .eq('id', bookingId)
    .select(COLUMNS)
    .single()
  if (error) throw error
  return toDomain(data as BookingRow)
}
