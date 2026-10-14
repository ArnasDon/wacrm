import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCurrency } from '@/lib/currency'
import { DAY_LABEL_ES, OCCUPANCY_LABEL_ES, TIER_GUESTS, formatDateEs } from '@/lib/products/rates'
import {
  loadStayPricingInputs,
  priceStay,
  resolveStayProductId,
  type StayPricing,
} from '@/lib/reservations/price'

// ============================================================
// Pre-computed stay total for the auto-reply hotel bot.
//
// The bot only ever received the RATE SUMMARY string ("pareja Lun–Jue
// Q500 · Vie–Dom Q700"), so answering "¿cuánto sería?" meant it had to
// work out the weekday of each night, pick the right tariff and add
// them up itself — which a small model gets wrong or, more often,
// dodges ("un compañero te confirma el total"). This runs the same
// `quoteStay()` the public catalog + quote builder use and hands the
// finished figure to the prompt.
//
// Only fires when there's a pending `reservation_requests` row for the
// conversation (habitaciones / paquetes) with both dates set and the
// product's per-night rates resolve.
// ============================================================

interface ReservationRow {
  id: string
  category: string
  service_name: string | null
  product_id: string | null
  guests: number | null
  /** Identical rooms (migration 159). null = 1. `guests` is the total. */
  rooms: number | null
  check_in: string | null
  check_out: string | null
  estimated_price: number | null
  /** Adults / children split (migration 160). */
  adults?: number | null
  children_ages?: number[] | null
}

const RESERVATION_COLS =
  'id, category, service_name, product_id, guests, rooms, check_in, check_out, estimated_price, adults, children_ages'
/** Before migration 160 is applied the two new columns don't exist —
 *  read without them rather than losing every estimate. */
const RESERVATION_COLS_LEGACY =
  'id, category, service_name, product_id, guests, rooms, check_in, check_out, estimated_price'

async function loadPendingStay(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ReservationRow | null> {
  const query = (cols: string) =>
    db
      .from('reservation_requests')
      .select(cols)
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .eq('status', 'pending')
      .in('category', ['habitaciones', 'paquetes'])
      .not('check_in', 'is', null)
      .not('check_out', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle<ReservationRow>()
  const first = await query(RESERVATION_COLS)
  if (!first.error) return first.data ?? null
  const legacy = await query(RESERVATION_COLS_LEGACY)
  return legacy.data ?? null
}

type Quoted = Extract<StayPricing, { kind: 'quoted' }>

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "2 habitaciones × 2 personas" / "2 personas" / "4 adultos y 1 niño" —
 *  the headcount as the guest said it. */
function headcountEs(p: Quoted): string {
  if (p.children) {
    const kids = p.children.charged + p.children.free + p.children.older
    const adults = plural(p.children.adults, 'adulto', 'adultos')
    return kids > 0 ? `${adults} y ${plural(kids, 'niño', 'niños')}` : adults
  }
  const people = (n: number) => plural(n, 'persona', 'personas')
  return p.rooms > 1 ? `${p.rooms} habitaciones × ${people(p.perRoom)}` : people(p.guests)
}

/** " (niños menores de 6 años sin costo)" when a free child is in the
 *  party — the guest sees why the total is lower than the headcount. */
function freeChildNote(p: Quoted): string {
  return p.children && p.children.free > 0 ? ' (los menores de 6 años no pagan)' : ''
}

/** How a partial estimate was built, as plain clauses (no parentheses —
 *  callers wrap them once): "calculado con la tarifa publicada de 4
 *  personas", … */
function partialBasisBits(p: Quoted): string[] {
  const bits: string[] = []
  if (p.partial.includes('adults_over_tier')) {
    bits.push(`calculado con la tarifa publicada de ${TIER_GUESTS[p.occupancy]} personas`)
  }
  if (p.partial.includes('older_child')) bits.push('los mayores de 12 años se calcularon como adultos')
  if (p.partial.includes('below_min_tier')) {
    bits.push(`calculado con la tarifa de ${OCCUPANCY_LABEL_ES[p.occupancy].trim() || p.occupancy}, la mínima de la habitación`)
  }
  return bits
}

/** " (calculado con…; los mayores de 12…)" — or ''. */
function partialBasisNote(p: Quoted): string {
  const bits = partialBasisBits(p)
  return bits.length ? ` (${bits.join('; ')})` : ''
}

/** The one line a partial estimate always carries (owner, 2026-09-26:
 *  "que le diga que ese es el estimado pero que por la cantidad de
 *  personas el equipo validará disponibilidad y precio"). */
function partialTeamLine(p: Quoted): string {
  return `Como son ${p.guests} personas, el equipo validará la disponibilidad y el precio final.`
}

/**
 * A ready-to-share stay estimate (Spanish, with the numbers), or null.
 * Also back-fills `reservation_requests.estimated_price` when it's still
 * null and every night priced cleanly — so the Google Sheet row and the
 * hotel Panel pick up the same figure.
 */
export async function loadHotelStayEstimate(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  currency: string,
  depositPercent = 50,
): Promise<string | null> {
  // Keep the positional API compatible; pending stays never request a deposit.
  void depositPercent
  const rr = await loadPendingStay(db, accountId, conversationId)
  if (!rr || !rr.check_in || !rr.check_out) return null

  const productId = await resolveStayProductId(db, accountId, rr)
  if (!productId) return null

  const { rates, maxGuests } = await loadStayPricingInputs(db, accountId, productId)
  if (rates.length === 0) return null

  // Never invent an occupancy: it determines the tariff. Several rooms
  // price each at its per-room occupancy — only when the total splits
  // evenly (B43); a room that prices children needs the adults/children
  // split first. A room that prices children never refuses for headcount
  // (owner, 2026-09-26): 5+ adults, a party over capacity or a 13+ child
  // get a partial estimate the team validates (`quote.partial`); other
  // rooms still skip 5+ (Angel, 2026-09-18).
  const quote = priceStay(rates, rr, maxGuests)
  if (quote.kind !== 'quoted' || quote.nights.length === 0) return null
  const { rooms, occupancy } = quote

  const label = (rr.service_name ?? 'la habitación').trim() || 'la habitación'
  const occLabel = quote.children
    ? `adultos: ${OCCUPANCY_LABEL_ES[occupancy].trim() || 'individual'}; niños 6–12 a tarifa de niño`
    : OCCUPANCY_LABEL_ES[occupancy].trim() || 'individual'
  const nightsWord = quote.nights.length === 1 ? 'noche' : 'noches'
  const breakdown = quote.nights
    .map((n) => `${formatDateEs(n.date)} ${DAY_LABEL_ES[n.day_of_week].toLowerCase()} ${n.price == null ? '(sin tarifa)' : formatCurrency(n.price, currency)}`)
    .join(' · ')

  const total = quote.total * rooms
  let text =
    `${label} · ${headcountEs(quote)}${freeChildNote(quote)} (${occLabel}) · ${quote.nights.length} ${nightsWord} ` +
    `(${formatDateEs(rr.check_in)} al ${formatDateEs(rr.check_out)}): ${breakdown}${rooms > 1 ? ' por habitación' : ''}. ` +
    `${quote.missing.length ? 'Subtotal de noches con tarifa' : 'Total estimado'}${rooms > 1 ? ` (${rooms} habitaciones)` : ''}: ${formatCurrency(total, currency)}.`
  if (quote.missing.length > 0) {
    text += ` (${quote.missing.join(', ')} sin tarifa publicada — esas noches las cotiza una persona.)`
  }
  text +=
    ' Este total sale de las tarifas publicadas del hotel; es un estimado — la disponibilidad y el precio final los confirma una persona.'
  if (quote.partial.length > 0) {
    text += ` SOLO ESTIMADO${partialBasisNote(quote)}: preséntelo así y diga que, por la cantidad de personas, el equipo validará la disponibilidad y el precio final — nunca niegue la solicitud.`
  }

  // Best-effort: seed the reservation's price so the Sheet + Panel agree.
  if (rr.estimated_price == null && quote.missing.length === 0 && total > 0) {
    await db
      .from('reservation_requests')
      .update({ estimated_price: total })
      .eq('id', rr.id)
      .is('estimated_price', null)
  }

  return text
}

// ============================================================
// Proactive stay-estimate follow-up (2026-09-20).
//
// Real incident: a guest asked for a Suite Clásica 2-night stay
// (Wed–Thu, both nights the CORPORATE rate). `resolveStayProductId`'s
// name match was ambiguous — "Suite Clásica" is a substring of BOTH
// "Suite Clásica (Individual o Pareja)" and "Suite Clásica Doble" — so
// it returned null, and `loadHotelStayEstimate` above returned null too.
// With no system-computed number to draw on, the model stated a price
// itself in its OWN reply (Q800, the single-night WEEKEND reference
// rate lifted from the business's tariff description) and put it in the
// `record_reservation` marker's `precio` field — which `autoRecordReservation`
// (auto-reply.ts) then wrote straight into `reservation_requests.estimated_price`,
// SKIPPING the real per-night calculation entirely (`upsertReservationRequest`
// only recomputes when the caller leaves `estimated_price` unset). The
// guest was quoted Q800 for a stay that actually totals Q1,200 (Q600 × 2
// corporate nights).
//
// Two separate fixes came out of this: (1) `autoRecordReservation` now
// never trusts a model-supplied `precio` for habitaciones/paquetes at
// all — those two categories are ALWAYS priced here, deterministically,
// never guessed; (2) this function proactively pushes the computed total
// to the guest the moment it's clean and complete, instead of waiting for
// the model to notice `hotelStayEstimate` in its own context (which is
// always one turn stale — computed before the turn that completes it).
// ============================================================

export type StayEstimateStatus =
  | { status: 'incomplete' }
  | { status: 'too_large_group' } // 5+ guests — never auto-priced, by design
  | { status: 'uneven_rooms' } // several rooms, headcount doesn't split evenly — a person prices it
  | { status: 'needs_person' } // a child over 12, or several rooms with children — a person prices it
  | { status: 'unpriceable'; reason: 'no_product_match' | 'no_rates' | 'bad_dates' | 'missing_night_rate' }
  | {
      status: 'priced'
      reservationRequestId: string
      text: string
      /** The same figures worded as the LAST message after the bot's
       *  closing reply — no item/dates recap (the close just said them),
       *  and the one mention that a colleague confirms availability. */
      closingText: string
      /** English versions, for a guest the bot is answering in English
       *  (QA 2026-10-01: an English guest got the total in Spanish). */
      textEn: string
      closingTextEn: string
      total: number
    }

/** Sent after a hotel close when there is no fresh total to share. */
export const CLOSE_AVAILABILITY_LINE = 'Recepción debe verificar la disponibilidad; este estimado no confirma una reserva.'
export const CLOSE_AVAILABILITY_AND_TOTAL_LINE = 'Recepción debe verificar la disponibilidad y el total; todavía no hay una reserva confirmada.'
export const CLOSE_AVAILABILITY_LINE_EN = 'Reception must verify availability; this estimate does not confirm a booking.'
export const CLOSE_AVAILABILITY_AND_TOTAL_LINE_EN = 'Reception must verify availability and the total; the booking is not confirmed yet.'

/** Whether a reply is written in English — the model answers in the
 *  guest's language, so the system's own lines follow it. */
export function isEnglishText(text: string): boolean {
  const words = text.toLowerCase().match(/[a-záéíóúñ]+/g) ?? []
  const en = words.filter((w) => /^(the|and|you|your|is|are|for|with|we|will|to|of|please|thank|would|room|night|i|i'm|it)$/.test(w)).length
  const es = words.filter((w) => /^(el|la|los|las|de|que|y|en|para|su|con|por|usted|le|es|una|un)$/.test(w)).length
  return en >= 3 && en > es
}

/**
 * Same underlying data `loadHotelStayEstimate` computes, but as a
 * customer-facing message plus a status the caller can act on —
 * `auto-reply.ts` sends `text` proactively (deduped against
 * `ai_action_log` so an unchanged total is never repeated) and alerts an
 * owner on `unpriceable` (a real gap: a name that should have matched,
 * or rates that are missing) while staying silent on `incomplete` /
 * `too_large_group` (both expected, normal states).
 */
export async function computeStayEstimateStatus(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  currency: string,
  depositPercent = 50,
  /** Business-local YYYY-MM-DD: a stay starting before it is never priced
   *  (test run 2026-09-24 — past dates were quoted and sent). */
  todayISO?: string,
): Promise<StayEstimateStatus> {
  // Keep the positional API compatible; pending stays never request a deposit.
  void depositPercent
  const rr = await loadPendingStay(db, accountId, conversationId)
  if (!rr || !rr.check_in || !rr.check_out) return { status: 'incomplete' }
  if (!rr.guests && !rr.adults) return { status: 'incomplete' }
  if (todayISO && rr.check_in < todayISO) return { status: 'incomplete' }
  // No room picked yet ("1 habitación para hoy") — keep collecting, not an owner alert.
  if (!rr.product_id && !rr.service_name?.trim()) return { status: 'incomplete' }

  const productId = await resolveStayProductId(db, accountId, rr)
  if (!productId) return { status: 'unpriceable', reason: 'no_product_match' }

  const { rates, maxGuests } = await loadStayPricingInputs(db, accountId, productId)
  if (rates.length === 0) return { status: 'unpriceable', reason: 'no_rates' }

  const quote = priceStay(rates, rr, maxGuests)
  if (quote.kind === 'incomplete') return { status: 'incomplete' }
  if (quote.kind === 'uneven_rooms') return { status: 'uneven_rooms' }
  if (quote.kind === 'too_large_group') return { status: 'too_large_group' }
  if (quote.kind === 'needs_person') return { status: 'needs_person' }
  if (quote.nights.length === 0) return { status: 'unpriceable', reason: 'bad_dates' }
  if (quote.missing.length > 0) return { status: 'unpriceable', reason: 'missing_night_rate' }
  const { rooms } = quote

  const label = (rr.service_name ?? 'la habitación').trim() || 'la habitación'
  const nightsWord = quote.nights.length === 1 ? 'noche' : 'noches'
  const total = quote.total * rooms
  // A package priced for several nights repeats the package rate each
  // night, but the extra night's real price (and e.g. Luna de Miel's 25%
  // second-night discount) is the team's call — QA 2026-10-01 quoted
  // Q3,400 right after the bot promised the discount.
  const packageNightsNote =
    rr.category === 'paquetes' && quote.nights.length > 1
      ? 'El precio de la noche adicional del paquete (y su descuento, si aplica) lo confirma el equipo.'
      : ''
  // No "a person confirms availability" disclaimer here: the model's own
  // closing already says it once, and repeating it in every system
  // message read as duplicated noise (test run 2026-09-22).
  const text =
    `El total estimado sería de ${formatCurrency(total, currency)} por ${quote.nights.length} ${nightsWord} ` +
    `para ${headcountEs(quote)}${freeChildNote(quote)} en ${label}, del ${formatDateEs(rr.check_in)} al ${formatDateEs(rr.check_out)}${partialBasisNote(quote)}. ` +
    CLOSE_AVAILABILITY_LINE +
    (quote.partial.length > 0 ? ` ${partialTeamLine(quote)}` : '') +
    (packageNightsNote ? ` ${packageNightsNote}` : '')

  // Same best-effort seed loadHotelStayEstimate does — keeps the Sheet /
  // Panel figure correct even if this exact total was already stored
  // (e.g. from a stale model-supplied guess this now overwrites).
  if (rr.estimated_price == null || Number(rr.estimated_price) !== total) {
    await db.from('reservation_requests').update({ estimated_price: total }).eq('id', rr.id)
  }

  const nightsPart = `${quote.nights.length} ${nightsWord}`
  // One parenthesis, clauses separated by "; " — never "(…) (…)" or
  // "(… (…))" (owner, 2026-09-26).
  const detailBits = [
    ...(rooms > 1 || quote.children ? [headcountEs(quote)] : []),
    ...(quote.children && quote.children.free > 0 ? ['los menores de 6 años no pagan'] : []),
    ...partialBasisBits(quote),
  ]
  const closingText =
    `El total estimado de su solicitud es de ${formatCurrency(total, currency)} por ${nightsPart}` +
    `${detailBits.length ? ` (${detailBits.join('; ')})` : ''}. ` +
    (quote.partial.length > 0
      ? `Es un estimado: ${lowerFirst(partialTeamLine(quote))}${packageNightsNote ? ` ${packageNightsNote}` : ''} 😊`
      : packageNightsNote
        ? `Es un estimado: ${lowerFirst(packageNightsNote)} ${CLOSE_AVAILABILITY_LINE}`
        : CLOSE_AVAILABILITY_LINE)

  const estimateNoteEn = quote.partial.length > 0 || packageNightsNote ? ' This is an estimate; the team will confirm the final amount.' : ''
  const nightsEn = `${quote.nights.length} ${quote.nights.length === 1 ? 'night' : 'nights'}`
  const textEn =
    `The estimated total would be ${formatCurrency(total, currency)} for ${nightsEn} at ${label}, ` +
    `${formatDateEs(rr.check_in)} to ${formatDateEs(rr.check_out)}. ${CLOSE_AVAILABILITY_LINE_EN}${estimateNoteEn}`
  const closingTextEn =
    `The estimated total for your request is ${formatCurrency(total, currency)} for ${nightsEn}, ` +
    `${estimateNoteEn} ${CLOSE_AVAILABILITY_LINE_EN}`

  return { status: 'priced', reservationRequestId: rr.id, text, closingText, textEn, closingTextEn, total }
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
