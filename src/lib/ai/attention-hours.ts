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
