import type { ChatMessage } from './types'
import { hotelReceptionReason } from './hotel-assistance'

export const HOTEL_DIRECT_SERVICE_POLICY = `HOTEL SERVICE PRIORITY (overrides sales/closing instructions): Distinguish eligible SALES from STAY OPERATIONS: continue new lodging inquiries, public prices, dates, party details, published menus and general hours. Assigned room numbers, keys/access, room incidents, current guest service and real-time meal availability belong to reception; do not invent operational answers or reopen these as sales. Answer the exact latest question first, in 2-3 short sentences when possible. Be warm with usted, con gusto or por favor; do not repeat names, greetings, perfectos, emojis or generic closings. A factual answer or thanks needs no sales question. Ask only missing current details; use explicit guest counts and dates already stated, even if no record exists yet. Compare requested options before asking the guest to select. A new inquiry is not a reschedule of a past stay. If the guest is frustrated, acknowledge the specific inconvenience briefly, answer directly and do not resend a form or ask for data already provided. Never claim a cancellation, refund, change of dates, room distribution, quantities or existing quotation has been made, will be made or is approved. Never say 'le modifico las cantidades'. Only hotel staff can decide whether a requested change is possible; retain all existing booking details until staff confirms. Route these operations to reception with the authorized daytime maximum 2-hour window or overnight business hours 08:00-20:00. Do not ask permission to route a request that requires staff. Do not invent availability, discounts, promises or prices. Never copy confrontational language or pressure from staff history.`

export function hotelChangeRequest(messages: ChatMessage[]): boolean {
  const reason = hotelReceptionReason(messages)
  if (reason && /cancelaci|cambio de reserva|cambio en las habitaciones/.test(reason)) return true
  const trailing: string[] = []
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'user'; i--) trailing.unshift(messages[i].content)
  const text = trailing.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(politicas?|condiciones|plazo|policy)\b/.test(text)) return false
  return /\b(cambiar|modificar|mover|reducir|aumentar|actualizar|corregir|anular|posponer|trasladar)\b/.test(text)
    && /\b(cantidades|participantes|asistentes|mi cotizacion|la cotizacion|mi reserva|la reserva|habitaciones|fechas)\b/.test(text)
}

export function hotelChangeConfirmationLine(afterHours: boolean): string {
  return 'Con gusto. El hotel revisar\u00e1 su solicitud y le confirmar\u00e1 si es posible realizarla '
    + (afterHours ? 'en horario h\u00e1bil, de 8:00 a. m. a 8:00 p. m.' : 'en un m\u00e1ximo de 2 horas.')
}

/** Only use a total explicitly stated for one party; never infer adults/children or sum rooms. */
export function explicitGuestCount(text: string): number | undefined {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(?:adultos|ninos|menores|por habitacion|cada habitacion)\b/.test(normalized)) return undefined
  const words: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }
  const matches = [...normalized.matchAll(/\b(\d+|una|un|dos|tres|cuatro|cinco|seis)\s+personas?\b/g)]
  if (matches.length !== 1) return undefined
  const count = words[matches[0][1]] ?? Number(matches[0][1])
  return Number.isInteger(count) && count > 0 ? count : undefined
}

/** Block affirmative execution claims even if the model ignores the policy. */
export function claimsExecutedHotelChange(text: string): boolean {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return /\b(?:le |te )?(?:modifico|cancelo|reprogramo|reagendo|anulo)\b/.test(t)
    || /\b(?:he|hemos|ya) (?:cancelado|modificado|cambiado|reprogramado|reagendado|anulado|movido)\b/.test(t)
    || /\b(?:reserva|reservacion) (?:ya )?(?:esta |queda |quedo |ha sido )?(?:cancelada|modificada|reprogramada|reagendada|anulada)\b/.test(t)
}
