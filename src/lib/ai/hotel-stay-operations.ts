import type { ChatMessage } from './types'
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const ARRIVED = /\b(?:ya (?:estoy|estamos|llegue|llegamos)|estoy hospedado|estoy hospedada|estamos hospedados|estamos hospedadas|en mi habitacion|en nuestra habitacion|vamos llegando|estamos por llegar|(?:un ratito|unos minutos) llegamos|llegamos al hotel|llegar al hotel)\b/

/** Real-time stay logistics need hotel staff, unlike public sales information.
 * Use current customer text, not old operational words from a previous visit. */
export function hotelStayOperationReason(messages: ChatMessage[]): string | null {
  const trailing: ChatMessage[] = []
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'user'; i--) trailing.unshift(messages[i])
  if (!trailing.length) return null
  const latest = Date.parse(trailing[trailing.length - 1].createdAt ?? '')
  const current = trailing.filter(m => !Number.isFinite(latest) || !m.createdAt || latest - Date.parse(m.createdAt) <= 30 * 60_000)
  const text = normalize(current.map(m => m.content).join(' '))
  if (/\b(?:numero|num|asignacion|llave|llaves|tarjeta|codigo de acceso) (?:de |del |para )?(?:mi |nuestra |la |su )?(?:habitacion|cuarto)\b|\b(?:que|cual) (?:es |sera )?(?:mi |nuestra )?(?:habitacion|cuarto) (?:asignad[oa]|me (?:toca|asignaron))\b/.test(text))
    return 'Recepci\u00f3n debe confirmar la habitaci\u00f3n asignada o coordinar su acceso.'
  if (/\b(?:no (?:funciona|sirve|hay)|se (?:rompio|descompuso)|problema con|falla)\b.{0,55}\b(?:agua caliente|ducha|cerradura|llave|luz|electricidad|television|wifi|wi.fi|calefaccion)\b|\b(?:agua caliente|ducha|cerradura|wifi|wi.fi)\b.{0,35}\b(?:no funciona|no sirve|no hay|fallando)\b/.test(text))
    return 'El hotel debe atender una incidencia de la habitaci\u00f3n o sus servicios.'
  const recentGuest = messages.filter(m => m.role === 'user' && (!Number.isFinite(latest) || !m.createdAt || latest - Date.parse(m.createdAt) <= 24 * 60 * 60_000)).slice(-12)
  const staying = ARRIVED.test(normalize(recentGuest.map(m => m.content).join(' ')))
  const meal = /\b(?:cenar|comer|cena|almuerzo|desayuno|cocina|restaurante|servicio a la habitacion|room service)\b/.test(text)
  const realTime = /\b(?:hay (?:cena|almuerzo|desayuno) disponible|ahora|ahorita|en este momento|todavia (?:hay|sirven|podemos)|sigue abiert[oa]|pueden (?:llevar|subir)|servicio a la habitacion|room service)\b/.test(text)
  const mealAvailability = /\b(?:disponible|podemos|puedo|para cenar|para comer|hay cena|hay desayuno|hay almuerzo)\b/.test(text)
  if (meal && (realTime || (staying && mealAvailability)))
    return 'Restaurante o recepci\u00f3n debe confirmar el servicio disponible para el hu\u00e9sped en este momento.'
  if (staying && /\b(?:toallas|limpieza|equipaje|mi llave|nuestra llave|mi tarjeta|mi habitacion no|nuestra habitacion no)\b/.test(text))
    return 'Recepci\u00f3n debe coordinar la atenci\u00f3n del hu\u00e9sped durante su estad\u00eda.'
  return null
}
