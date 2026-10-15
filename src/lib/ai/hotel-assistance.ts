import type { ChatMessage } from './types'

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const OPERATIONAL = /\b(cancel\w*|reembols\w*|devol\w*|pago\w*|pagar|deposit\w*|anticipo|comprobante|factura|cotiz\w*|voucher|cupon|certificado|tour operador|toperador|tarifa especial|precio especial|clientes? frecuentes?|corporativ\w*|mi reserva|nuestra reserva|confirm\w*|reprogram\w*|reagend\w*|no entiendo|no entendi|no comprendo|i don.t understand|refund|cancel|payment|invoice|quote)\b/
const INFORMATION = /\b(horarios?|a que hora|check.?in|check.?out|desayun\w*|almuerz\w*|cena\w*|parqueo|wifi|wi.fi|mascotas?|piscina|gimnasio|jacuzzi|ubicacion|direccion|como lleg\w*|fotos?|fotograf\w*|imagenes?|menu|breakfast|parking|photos?|directions|amenities)\b/
const NEW_INQUIRY = /\b(hospedaje|alojamiento|habitacion\w*|suite|paquete|masaje|spa|stay|room)\b/

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
