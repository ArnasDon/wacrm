/** Hotel handoffs must not promise deadlines that reception has not agreed. */
import { hourInTimeZone } from './followups'

const NIGHT_LINE = 'Nuestro horario de atención es de 8:00 am a 8:00 pm.'
const PROMISE_RE = /(?:\s*,)?\s*\b(?:en breve|en un momento|muy pronto|en unos minutos|(?:en )?un m[aá]ximo de (?:una hora|1 hora|20 minutos)|en menos de una hora)\b/gi
const DEADLINE_SENTENCE_RE = /(?:Le dar[aá]n seguimiento|Le atender[aá]n|Le responder[aá]n)\s+(?:en )?un m[aá]ximo de (?:una|1) hora[.!]?\s*/gi

export function isAfterHours(now: Date, timeZone: string): boolean {
  const h = hourInTimeZone(now, timeZone)
  return h >= 20 || h < 8
}

export function withAttentionHours(text: string, afterHours: boolean, force = false): string {
  if (!text) return text
  const base = text.replace(DEADLINE_SENTENCE_RE, '').replace(PROMISE_RE, '')
    .replace(/\s+([.,;!?])/g, '$1').replace(/[ ]{2,}/g, ' ').trim()
  if (!afterHours || !force || /horario de atenci[oó]n/i.test(base)) return base
  const emoji = base.match(/\s*[\p{Extended_Pictographic}️]+$/u)?.[0] ?? ''
  return `${base.slice(0, base.length - emoji.length)} ${NIGHT_LINE}${emoji}`
}


/** The hotel owner has authorized these availability follow-up windows. */
export function availabilityConfirmationLine(afterHours: boolean, english = false): string {
  if (english) return afterHours
    ? 'The hotel will confirm which room is available during reception hours, from 8:00 am to 8:00 pm.'
    : 'The hotel will confirm availability within a maximum of 2 hours.'
  return afterHours
    ? 'El hotel le confirmar\u00e1 qu\u00e9 habitaci\u00f3n estar\u00eda disponible en horario h\u00e1bil, de 8:00 a. m. a 8:00 p. m.'
    : 'El hotel le confirmar\u00e1 la disponibilidad en un m\u00e1ximo de 2 horas.'
}

export function withAvailabilityConfirmationTiming(text: string, afterHours: boolean, english = false): string {
  const line = availabilityConfirmationLine(afterHours, english)
  if (text.includes(line)) return text
  let base = withAttentionHours(text, afterHours)
  if (afterHours) base = base.replace(/\s*(?:en (?:un m[aá]ximo de )?(?:2|dos) horas|within (?:a maximum of )?(?:2|two) hours)/gi, '')
    .replace(/\s+([.,;!?])/g, '$1').trim()
  return [base, line].filter(Boolean).join(' ')
}
