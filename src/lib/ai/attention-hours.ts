/**
 * Hotel hand-offs promise a real time frame (owner meeting, 2026-10-09):
 * by day "en un máximo de una hora"; between 8 pm and 7 am the guest is
 * told the attention hours instead of a "en breve" nobody can keep.
 */
import { hourInTimeZone } from './followups'

// ponytail: VSR's hours hardcoded; make it a per-account setting when a second hotel needs different ones.
const DAY_LINE = 'Le darán seguimiento en un máximo de una hora.'
const NIGHT_LINE = 'Nuestro horario de atención es de 8:00 am a 8:00 pm; en ese horario le darán seguimiento.'

const PROMISE_RE = /(?:\s*,)?\s*\b(?:en breve|en un momento|muy pronto|en unos minutos|(?:en )?un m[aá]ximo de 20 minutos)\b/gi
const HAS_PROMISE_RE = new RegExp(PROMISE_RE.source, 'i')
const HAS_TIME_FRAME_RE = /m[aá]ximo de (?:una|1) hora|horario de atenci[oó]n/i
const TEAM_RE = /compa[ñn]er|equipo|asesor|\bel hotel le\b/i

export function isAfterHours(now: Date, timeZone: string): boolean {
  const h = hourInTimeZone(now, timeZone)
  return h >= 20 || h < 7
}

/**
 * Rewrites a "the team will get back to you" promise with the real time
 * frame. Untouched unless the text promises a teammate follow-up (or
 * `force`, for the hand-off acknowledgement itself).
 */
export function withAttentionHours(text: string, afterHours: boolean, force = false): string {
  // The model already gave the time frame itself (the account prompt asks it
  // to) — don't add a second one (VSR 2026-10-10: "…en un máximo de una hora.
  // Le darán seguimiento en un máximo de una hora.").
  if (!text || HAS_TIME_FRAME_RE.test(text)) return text
  if (!force && !(TEAM_RE.test(text) && HAS_PROMISE_RE.test(text))) return text
  const base = text.replace(PROMISE_RE, '').replace(/\s+([.,;!?])/g, '$1').trim()
  const line = afterHours ? NIGHT_LINE : DAY_LINE
  // Keep a closing emoji at the very end: "…disponibilidad. Le darán… 😊".
  const emoji = base.match(/\s*[\p{Extended_Pictographic}️]+$/u)?.[0] ?? ''
  return `${base.slice(0, base.length - emoji.length)} ${line}${emoji}`
}
