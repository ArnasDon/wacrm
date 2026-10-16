import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCurrency } from '@/lib/currency'
import { formatDateEs } from '@/lib/products/rates'

// ============================================================
// Facts the business already has on file for this contact/conversation
// that must survive regardless of how long the chat gets.
//
// `buildConversationContext` only feeds the model the last ~20 raw
// messages (`aiContextMessageLimit`). On a long-running thread — the
// kind a returning guest builds up over days or weeks — anything said
// earlier (their name, an earlier room/spa/event request) scrolls out
// of that window and the model has no way to know it was ever said.
// It can then re-ask for a name it was already given, or answer a new
// question with no memory that the same guest has another open
// request. Both loaders below run fresh on every turn from the DB
// (not from chat history), so these facts never actually disappear.
// ============================================================

const CATEGORY_LABEL_ES: Record<string, string> = {
  habitaciones: 'Habitación',
  spa: 'Spa',
  actividades: 'Actividad',
  paquetes: 'Paquete',
  eventos: 'Evento',
}

interface ReservationSummaryRow {
  category: string
  service_name: string | null
  guests: number | null
  rooms?: number | null
  adults?: number | null
  children_ages?: number[] | null
  check_in: string | null
  check_out: string | null
  use_date: string | null
  duration_minutes: number | null
  hall: string | null
  estimated_price: number | null
  guest_confirmed_at?: string | null
  decoration?: string | null
  notes?: string | null
  is_active_build?: boolean | null
}

/**
 * One line per category of every active hotel request already captured
 * for this conversation (`reservation_requests`, migrations 112/120) —
 * a guest can have a room, a spa slot, and an event request all open at
 * once, and each is captured independently. Only the CURRENT build per
 * category (`is_active_build`) and still-pending rows are considered —
 * a request that was already approved/denied, or superseded by a later
 * one in the same category, isn't something the bot should keep
 * repeating back.
 *
 * Split into two buckets when `todayISO` is given (the caller's own
 * "today" in the business's timezone, `YYYY-MM-DD`):
 *  - `current`: still relevant — no date yet, or a date today/in the
 *    future. Same "already captured, don't re-ask" recap as before.
 *  - `stale`: a room/package/spa/activity/event whose date (check_out,
 *    or use_date for a single-date category) has already PASSED while
 *    the request sat at `status: 'pending'` — i.e. staff never
 *    confirmed or denied it and the date came and went. Real gap found
 *    2026-09-21: a stale pending request keeps getting recapped to the
 *    model as "already captured, don't ask again" indefinitely, with
 *    its now-meaningless old dates, as historical context, without prompting an unsolicited reschedule.
 *
 * `todayISO` omitted (the handoff-recap caller, `appendActiveReservationsRecap`
 * — a human reads this, not the model) skips the split entirely: every
 * pending row comes back in `current`, `stale` is always null, matching
 * this function's original behavior exactly.
 *
 * `includeRetired` (the handoff recap only) also lists still-pending
 * rows a newer request in the same category retired (`is_active_build
 * = false`, `nueva=1`), tagged "solicitud anterior". The bot must not
 * repeat them, but the team still has to confirm them — drip test
 * 2026-09-26: an October package retired by a December one was missing
 * from the team summary.
 *
 * Both fields are null when there's nothing in that bucket to recap.
 */
export async function loadActiveReservationsSummary(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  currency: string,
  todayISO?: string,
  opts: { includeRetired?: boolean } = {},
): Promise<{ current: string | null; stale: string | null }> {
  let query = db
    .from('reservation_requests')
    .select(
      'category, service_name, guests, rooms, adults, children_ages, check_in, check_out, use_date, duration_minutes, hall, estimated_price, guest_confirmed_at, decoration, notes, is_active_build',
    )
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
  if (!opts.includeRetired) query = query.eq('is_active_build', true)
  const { data } = await query
    .order('category', { ascending: true })
    .order('created_at', { ascending: true })

  const rows = (data ?? []) as ReservationSummaryRow[]
  if (rows.length === 0) return { current: null, stale: null }

  const renderLine = (r: ReservationSummaryRow): string => {
    const label = CATEGORY_LABEL_ES[r.category] ?? r.category
    const service = (r.service_name ?? '').trim()
    const bits: string[] = [service ? `${label}: ${service}` : label]
    if (r.check_in && r.check_out) bits.push(`${formatDateEs(r.check_in)} → ${formatDateEs(r.check_out)}`)
    else if (r.use_date) bits.push(formatDateEs(r.use_date))
    if (r.rooms && r.rooms > 1) bits.push(`${r.rooms} habitaciones`)
    if (r.guests) bits.push(`${r.guests} ${r.guests === 1 ? 'persona' : 'personas'}${r.rooms && r.rooms > 1 ? ' en total' : ''}`)
    if (r.adults) {
      const ages = r.children_ages ?? []
      const completeSplit = r.children_ages != null && (!r.guests || r.adults + ages.length === r.guests)
      bits.push(
        ages.length > 0
          ? `${r.adults} ${r.adults === 1 ? 'adulto' : 'adultos'} + ${ages.length} ${ages.length === 1 ? 'niño' : 'niños'} (${ages.join(', ')} años)`
          : `${r.adults} ${r.adults === 1 ? 'adulto' : 'adultos'}, ${completeSplit ? 'sin niños' : 'edades de niños pendientes'}`,
      )
    }
    if (r.duration_minutes) bits.push(`${r.duration_minutes} min`)
    if (r.hall) bits.push(r.hall)
    if (r.estimated_price != null && r.estimated_price > 0) {
      bits.push(`estimado ${formatCurrency(r.estimated_price, currency)}`)
    }
    // Details with no column of their own (time, catering, rooms…) — the
    // team reads this recap in the hand-off note (test run 2026-09-24).
    if (r.decoration?.trim()) bits.push(`decoración: ${r.decoration.trim()}`)
    if (r.notes?.trim()) bits.push(`nota: ${r.notes.trim()}`)
    if (r.guest_confirmed_at) bits.push('YA ENVIADA AL EQUIPO')
    if (r.is_active_build === false) bits.push('solicitud anterior, sigue pendiente')
    return `- ${bits.join(' · ')}`
  }

  const isStale = (r: ReservationSummaryRow): boolean => {
    if (!todayISO) return false
    const relevantDate = r.check_out || r.use_date
    return Boolean(relevantDate && relevantDate < todayISO)
  }

  const currentLines = rows.filter((r) => !isStale(r)).map(renderLine)
  const staleLines = rows.filter(isStale).map(renderLine)

  return {
    current: currentLines.length > 0 ? currentLines.join('\n') : null,
    stale: staleLines.length > 0 ? staleLines.join('\n') : null,
  }
}

interface KnownContactRow {
  name: string | null
}
interface CustomFieldRow {
  id: string
  field_name: string
}
interface CustomValueRow {
  custom_field_id: string
  value: string | null
}

/**
 * The contact's saved name plus any non-empty custom field value on
 * file for them (account-wide field definitions × this contact's own
 * values — same join `google-sheets/row-builder.ts` uses for the
 * "Requerimientos" Sheet). Generic across every vertical: whatever a
 * human, a Flow, or the bot itself has already captured into a
 * structured field is a fact worth repeating, not re-asking for.
 * Returns null when there's genuinely nothing to recap yet.
 */
export async function loadKnownContactFacts(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const [{ data: contact }, { data: fields }, { data: values }] = await Promise.all([
    db.from('contacts').select('name').eq('id', contactId).maybeSingle<KnownContactRow>(),
    db.from('custom_fields').select('id, field_name').eq('account_id', accountId),
    db.from('contact_custom_values').select('custom_field_id, value').eq('contact_id', contactId),
  ])

  const fieldNameById = new Map(
    ((fields ?? []) as CustomFieldRow[]).map((f) => [f.id, f.field_name]),
  )

  const lines: string[] = []
  const name = contact?.name?.trim()
  if (name) lines.push(`Nombre: ${name}`)
  for (const v of (values ?? []) as CustomValueRow[]) {
    const value = v.value?.trim()
    if (!value) continue
    const fieldName = fieldNameById.get(v.custom_field_id)
    if (!fieldName) continue
    lines.push(`${fieldName}: ${value}`)
  }

  return lines.length > 0 ? lines.join('\n') : null
}
