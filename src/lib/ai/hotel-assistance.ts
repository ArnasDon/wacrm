import type { ChatMessage } from './types'
import { isExplicitHumanRequest, isGiftVoucherAsk, isSpecialRateTalk } from './hotel-media-intent'

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const OPERATIONAL = /\b(cancel\w*|reembols\w*|devol\w*|pago\w*|pagar|deposit\w*|anticipo|comprobante|factura|cotiz\w*|voucher|cupon|certificado|tour operador|toperador|tarifa especial|precio especial|clientes? frecuentes?|corporativ\w*|mi reserva|nuestra reserva|confirm\w*|reprogram\w*|reagend\w*|no entiendo|no entendi|no comprendo|i don.t understand|refund|cancel|payment|invoice|quote)\b/
const INFORMATION = /\b(horarios?|a que hora|check.?in|check.?out|desayun\w*|almuerz\w*|cena\w*|parqueo|wifi|wi.fi|mascotas?|piscina|gimnasio|jacuzzi|ubicacion|direccion|como lleg\w*|fotos?|fotograf\w*|imagenes?|menu|breakfast|parking|photos?|directions|amenities)\b/
const NEW_INQUIRY = /\b(hospedaje|alojamiento|habitacion\w*|suite|paquete|masaje|spa|stay|room)\b/

export const HOTEL_RECEPTION_PENDING_PREFIX = '🤝 Pendiente de recepción.'

/** Only application-created reception notes qualify; manual takeovers use a different summary. */
export function isHotelReceptionPending(summary: string | null | undefined): boolean {
  return summary?.startsWith(HOTEL_RECEPTION_PENDING_PREFIX) ?? false
}

/** Route only messages received after an already-recorded handoff. Keep the
 * full transcript for generation so existing staff agreements remain visible. */
export function hotelCurrentRequest(messages: ChatMessage[], handoffAt?: string | null): ChatMessage[] {
  const since = handoffAt ? Date.parse(handoffAt) : NaN
  if (!Number.isFinite(since)) return messages
  const start = messages.findIndex((m) => m.role === 'user' && m.createdAt && Date.parse(m.createdAt) > since)
  if (start < 0) return messages
  // Silent staff decisions do not add an assistant turn. A later, separate
  // customer burst still needs to become eligible for a new factual topic.
  let burstStart = start
  for (let i = messages.length - 1; i > start; i--) {
    if (messages[i - 1].role !== 'user') { burstStart = i; break }
    const gap = Date.parse(messages[i].createdAt ?? '') - Date.parse(messages[i - 1].createdAt ?? '')
    if (gap > 3 * 60_000) { burstStart = i; break }
  }
  return messages.slice(burstStart)
}

/** A hotel operation requiring a staff decision, rather than public information. */
export function hotelReceptionReason(messages: ChatMessage[]): string | null {
  const trailing: string[] = []
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'user'; i--) trailing.unshift(messages[i].content)
  const text = normalize(trailing.join(' '))
  if (isExplicitHumanRequest(text)) return 'El cliente solicita atención de una persona.'
  if (isGiftVoucherAsk(text)) return 'Recepción debe validar el voucher o certificado.'
  if (isSpecialRateTalk([text])) return 'Recepción debe revisar una tarifa especial o un convenio.'
  if (/\b(numero de cuenta|cuenta bancaria|datos bancarios|link de pago|enlace de pago|comprobante|boleta|ya pague|ya pagamos|deposite|transferi|quiero pagar|necesito pagar|pagar el anticipo|hacer el deposito|bank account|payment receipt)\b/.test(text)) return 'Recepción debe coordinar o verificar un pago.'
  const policyOnly = /\b(politicas?|condiciones|plazo|antelacion|policy)\b/.test(text)
    && !/\b(mi reserva|nuestra reserva|ya pague|mi pago|my booking)\b/.test(text)
  if (!policyOnly && /\b(cancel\w*|reembols\w*|devolucion|refund|cancell?ation)\b/.test(text)) return 'Recepción debe revisar una cancelación o devolución.'
  if (/\b(reprogram\w*|reagend\w*)\b/.test(text)
    || (/\b(cambiar|modificar|mover|cambio)\b/.test(text) && /\b(mi reserva|nuestra reserva|la reserva|mi reservacion|my booking)\b/.test(text))) return 'Recepción debe revisar un cambio de reserva.'
  if (/\b(mi factura|necesito (?:una |la )?factura|envie\w* (?:la |mi )?factura|factura a nombre|my invoice)\b/.test(text)) return 'Recepción debe revisar la facturación solicitada.'
  if (/\b(ya (?:llene|complete|envie|llenamos|completamos) el formulario|mi cotizacion|nuestra cotizacion|la cotizacion|mi reserva esta confirmada|confirmad[oa] mi|estado de mi reserva)\b/.test(text)) return 'El cliente da seguimiento a una gestión pendiente del hotel.'
  const group = /\b(grupos?|eventos?|bodas?|salon|delegacion|excursion|empresas?|group|wedding|event)\b/.test(text)
    || Array.from(text.matchAll(/\b(\d+)\s*(?:personas|adultos|huespedes|people|guests)\b/g)).some((m) => Number(m[1]) > 6)
  if (group && /\b(cotiz\w*|presupuesto|precio\w*|tarifa\w*|cuanto|quote|price)\b/.test(text)) return 'Recepción debe preparar la cotización de grupo o evento.'
  return null
}

/** After the three-hour window, staff business stays with staff. Only
 * factual information (or an unmistakable new inquiry with no open request)
 * may resume automatically. A bare yes, guest count or confusion is not one. */
export function shouldDeferHotelStaffFollowup(messages: ChatMessage[], hasActiveRequest: boolean): boolean {
  const trailing: string[] = []
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'user'; i--) trailing.unshift(messages[i].content)
  const text = normalize(trailing.join(' '))
  if (OPERATIONAL.test(text)) return true
  if (INFORMATION.test(text)) return false
  if (!hasActiveRequest && NEW_INQUIRY.test(text)) return false
  return true
}

/** Detect a stated arrival with no explicit departure, interval or length.
 * Prevents turning “alojamiento para el domingo 18” into an invented night. */
export function hasUnconfirmedStayDuration(messages: ChatMessage[]): boolean {
  // Ignore dates from earlier bookings once the guest states a new arrival.
  let start = 0
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user' && /\b(?:alojamiento|hospedaje|estadia|estancia|entrada|ingreso|llegada|llego|llegamos|check.?in|arrival|stay)\b/.test(normalize(messages[i].content))) start = i
  }
  const current = messages.slice(start)
  const users = current.filter((m) => m.role === 'user').map((m) => normalize(m.content))
  const dates = users.join(' ')
  const explicit = /\b(?:\d+|una|un|dos|tres|one|two|three)\s+(?:noches?|nights?)\b|\b(?:salida|check.?out|departure)\b|\b(?:del|desde|from)\s+.{0,35}\b(?:al|hasta|to)\s+\d|\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+(?:a|al|hasta)\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(dates)
  if (explicit) return false
  // A guest may confirm the dates in the bot's explicit question.
  for (let i = 1; i < current.length; i++) {
    if (current[i].role === 'user' && /^(si|ok|correcto|confirmo|yes|correct)\b/.test(normalize(current[i].content).trim())
      && current[i - 1].role === 'assistant' && /[?¿]/.test(current[i - 1].content)
      && /salida|check.?out|departure/i.test(current[i - 1].content)) return false
  }
  return /\b(?:alojamiento|hospedaje|estadia|estancia|entrada|ingreso|llegada|llego|llegamos|check.?in|arrival|stay)\b/.test(dates)
    && /\d{1,2}|lunes|martes|miercoles|jueves|viernes|sabado|domingo/.test(dates)
}
