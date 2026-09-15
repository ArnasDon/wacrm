import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCurrency } from '@/lib/currency'

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
  check_in: string | null
  check_out: string | null
  use_date: string | null
  duration_minutes: number | null
  hall: string | null
  estimated_price: number | null
}

/**
 * One line per category of every active hotel request already captured
 * for this conversation (`reservation_requests`, migrations 112/120) —
 * a guest can have a room, a spa slot, and an event request all open at
 * once, and each is captured independently. Only the CURRENT build per
 * category (`is_active_build`) and still-pending rows are included —
 * a request that was already approved/denied, or superseded by a later
 * one in the same category, isn't something the bot should keep
 * repeating back. Returns null when there's nothing open to recap.
 */
export async function loadActiveReservationsSummary(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  currency: string,
): Promise<string | null> {
  const { data } = await db
    .from('reservation_requests')
    .select(
      'category, service_name, guests, check_in, check_out, use_date, duration_minutes, hall, estimated_price',
    )
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('is_active_build', true)
    .eq('status', 'pending')
    .order('category', { ascending: true })

  const rows = (data ?? []) as ReservationSummaryRow[]
  if (rows.length === 0) return null

  const lines = rows.map((r) => {
    const label = CATEGORY_LABEL_ES[r.category] ?? r.category
    const service = (r.service_name ?? '').trim()
    const bits: string[] = [service ? `${label}: ${service}` : label]
    if (r.check_in && r.check_out) bits.push(`${r.check_in} → ${r.check_out}`)
    else if (r.use_date) bits.push(r.use_date)
    if (r.guests) bits.push(`${r.guests} ${r.guests === 1 ? 'persona' : 'personas'}`)
    if (r.duration_minutes) bits.push(`${r.duration_minutes} min`)
    if (r.hall) bits.push(r.hall)
    if (r.estimated_price != null && r.estimated_price > 0) {
      bits.push(`estimado ${formatCurrency(r.estimated_price, currency)}`)
    }
    return `- ${bits.join(' · ')}`
  })

  return lines.join('\n')
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
