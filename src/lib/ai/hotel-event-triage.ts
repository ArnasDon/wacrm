import type { ChatMessage } from './types'

export const EVENT_TRIAGE_QUESTION = 'Para orientarle con su evento, \u00bftiene un n\u00famero de cotizaci\u00f3n, su cotizaci\u00f3n est\u00e1 en curso o desea solicitar una cotizaci\u00f3n nueva?'
export type EventTriage = 'none' | 'ask' | 'new' | 'existing'
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const EVENT = /\b(eventos?|bodas?|salon(?:es)?|cumpleanos|quincean(?:era|os)|graduacion|bautizo|reunion empresarial|weddings?|events?)\b/
const OTHER_TOPIC = /\b(habitacion\w*|hospedaje|alojamiento|spa|masaje|restaurante)\b/

/** Infer the choice from customer turns, never from a bot's suggested answer. */
export function hotelEventTriage(messages: ChatMessage[]): EventTriage {
  let state: EventTriage = 'none'
  let asked = false
  for (const message of messages) {
    const text = normalize(message.content)
    if (message.role === 'assistant') {
      if (message.senderType !== 'agent' && message.content === EVENT_TRIAGE_QUESTION) { state = 'ask'; asked = true }
      continue
    }
    if (EVENT.test(text)) { if (state === 'none') state = 'ask' }
    else if (OTHER_TOPIC.test(text)) { state = 'none'; asked = false; continue }
    if (state === 'none') continue
    const noQuote = /\b(no tengo|no tenemos|aun no tengo|todavia no tengo)\b/.test(text)
    const newQuote = /\b(?:quiero|quisiera|deseo|necesito|queremos|solicitar|solicito) (?:una |que me |que nos )?(?:cotiz\w*|presupuesto)\b|\bcotiz\w* nueva\b|\bnueva cotiz\w*\b/.test(text)
    const existing = !noQuote && (/\b(?:mi|nuestra) cotizacion\b|\b(?:tengo|tenemos|ya tengo|ya tenemos) (?:el |un |una )?(?:numero|cotizacion)\b|\b(?:cotizacion|tramite) (?:esta |sigue )?(?:en curso|en proceso|pendiente)\b|\bya (?:me |nos )?(?:cotizaron|enviaron la cotizacion)\b/.test(text)
      || /\b(?:en curso|en proceso|en tramite)\b|\b(?:numero|cotizacion|folio)\s*[:#-]?\s*[a-z]*[-/]?\d+\b/.test(text)
      || (asked && /^(?:\s*\d{3,}\s*|pendiente)$/.test(text)))
    if (existing) state = 'existing'
    else if (newQuote || (asked && /^(?:cotizar|nueva|deseo cotizar)[.!\s]*$/.test(text))) state = 'new'
    else if (noQuote) state = 'ask'
  }
  return state
}

export function eventFollowupLine(afterHours: boolean): string {
  return afterHours
    ? 'Un compa\u00f1ero del hotel dar\u00e1 seguimiento a su cotizaci\u00f3n en horario h\u00e1bil, de 8:00 a. m. a 8:00 p. m.'
    : 'Un compa\u00f1ero del hotel dar\u00e1 seguimiento a su cotizaci\u00f3n en un m\u00e1ximo de 2 horas.'
}
