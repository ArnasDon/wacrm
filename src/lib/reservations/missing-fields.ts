import type { ReservationCategory } from './upsert'

/** The reservation fields a follow-up nudge cares about — a subset of
 *  the full `reservation_requests` row (or an empty snapshot when no
 *  row exists yet for this category/product). */
export interface ReservationFieldSnapshot {
  category: ReservationCategory
  guests?: number | null
  check_in?: string | null
  check_out?: string | null
  use_date?: string | null
  hall?: string | null
}

const DATE_RANGE_CATEGORIES = new Set<ReservationCategory>(['habitaciones', 'paquetes'])
const USE_DATE_CATEGORIES = new Set<ReservationCategory>(['spa', 'actividades', 'eventos'])

/**
 * Which pieces of information are still missing to confirm this
 * reservation, in plain Spanish, for the deterministic "¿le gustaría
 * confirmar?" nudge sent after a photo or a quote (hotel vertical
 * only — see [[proactive-reservation-followup]]). Every category needs
 * a guest count; `habitaciones`/`paquetes` need a stay date RANGE,
 * `spa`/`actividades`/`eventos` need a single-use date, and `eventos`
 * additionally needs the hall. Returns `[]` when nothing is missing —
 * the caller sends a plain confirmation invite instead.
 */
export function missingReservationFields(row: ReservationFieldSnapshot): string[] {
  const missing: string[] = []
  if (DATE_RANGE_CATEGORIES.has(row.category)) {
    if (!row.check_in || !row.check_out) missing.push('las fechas de entrada y salida')
  } else if (USE_DATE_CATEGORIES.has(row.category)) {
    if (!row.use_date) missing.push('la fecha')
  }
  if (!row.guests) missing.push('el número de personas')
  if (row.category === 'eventos' && !row.hall) missing.push('el salón que le interesa')
  return missing
}

/** Renders the missing-field list (see `missingReservationFields`) into
 *  the actual WhatsApp text sent after a photo or quote. */
export function reservationFollowUpText(missing: string[]): string {
  if (missing.length === 0) {
    return '¿Le gustaría confirmar la reservación? Con gusto se la dejamos lista.'
  }
  const joined =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}`
  return `¿Le gustaría confirmar la reservación? Me falta ${joined} para dejarla lista.`
}
