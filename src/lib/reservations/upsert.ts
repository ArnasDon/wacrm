import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

// ============================================================
// Create-or-extend a hotel "solicitud" (reservation / service request),
// then fire `reservation.updated` so its Google Sheets category row is
// (re)written. Shared by the internal CRUD route, the public catalog
// form, the AI `record_reservation` tool and the quote builder.
// ============================================================

export type ReservationCategory =
  | 'habitaciones'
  | 'spa'
  | 'actividades'
  | 'paquetes'
  | 'eventos'

export const RESERVATION_CATEGORIES: ReservationCategory[] = [
  'habitaciones',
  'spa',
  'actividades',
  'paquetes',
  'eventos',
]

export type ReservationStatus = 'pending' | 'approved' | 'denied'
export type ReservationSource = 'manual' | 'catalog' | 'ai_chat' | 'quote_builder'

export interface ReservationInput {
  category: ReservationCategory
  contact_id?: string | null
  conversation_id?: string | null
  product_id?: string | null
  quote_id?: string | null
  service_name?: string | null
  guests?: number | null
  check_in?: string | null
  check_out?: string | null
  use_date?: string | null
  duration_minutes?: number | null
  hall?: string | null
  decoration?: string | null
  estimated_price?: number | null
  status?: ReservationStatus
  notes?: string | null
  source?: ReservationSource
}

/** Fields a caller may set. `undefined` = leave as-is; an explicit
 *  value (incl. `null`) is written. */
const SETTABLE_KEYS = [
  'contact_id',
  'conversation_id',
  'product_id',
  'quote_id',
  'service_name',
  'guests',
  'check_in',
  'check_out',
  'use_date',
  'duration_minutes',
  'hall',
  'decoration',
  'estimated_price',
  'status',
  'notes',
] as const

/**
 * Upsert a reservation request and fire `reservation.updated`.
 *
 * With `conversation_id` set it matches on `(conversation_id, category)`
 * so the AI keeps building the same row across turns — only the fields
 * actually present in `input` are written, so a sparse later turn never
 * blanks an earlier fact. Without it (catalog / quote builder) it always
 * inserts.
 *
 * `admin` must be a service-role client. Returns the reservation id, or
 * `null` on a write failure (best-effort, like the Sheets dispatch).
 */
export async function upsertReservationRequest(
  admin: SupabaseClient,
  accountId: string,
  input: ReservationInput,
): Promise<string | null> {
  const patch: Record<string, unknown> = {}
  for (const k of SETTABLE_KEYS) {
    const v = input[k as keyof ReservationInput]
    if (v !== undefined) patch[k] = v
  }

  let id: string | null = null

  if (input.conversation_id) {
    const { data: existing } = await admin
      .from('reservation_requests')
      .select('id')
      .eq('account_id', accountId)
      .eq('conversation_id', input.conversation_id)
      .eq('category', input.category)
      .maybeSingle<{ id: string }>()
    if (existing) {
      id = existing.id
      if (Object.keys(patch).length > 0) {
        const { error } = await admin
          .from('reservation_requests')
          .update(patch)
          .eq('id', id)
        if (error) {
          console.error('[reservations] update failed:', error.message)
          return null
        }
      }
    }
  }

  if (!id) {
    const { data, error } = await admin
      .from('reservation_requests')
      .insert({
        account_id: accountId,
        category: input.category,
        source: input.source ?? 'manual',
        ...patch,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[reservations] insert failed:', error?.message)
      return null
    }
    id = data.id as string
  }

  await dispatchWebhookEvent(admin, accountId, 'reservation.updated', {
    reservation_id: id,
    source: input.source ?? 'manual',
  })
  return id
}
