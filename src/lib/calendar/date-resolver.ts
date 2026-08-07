import { TZDate } from '@date-fns/tz'
import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  isValid,
  startOfDay,
  startOfMonth,
} from 'date-fns'

/**
 * Deterministic PT-PT relative-date resolver for the EterWA agent.
 *
 * The LLM never interprets relative dates itself — every inbound
 * message that might contain a date/time expression is run through
 * `resolveDate()` *before* the model sees it (or before a tool call
 * like `check_availability` executes), and the resolved ISO range is
 * what gets passed downstream. This keeps "próxima semana" meaning the
 * same thing on every call, in every account's timezone, regardless of
 * model drift.
 *
 * All resolution happens in the account's IANA timezone (`timezone`,
 * e.g. "Europe/Lisbon") via `@date-fns/tz`'s `TZDate` — never UTC and
 * never the server's local zone. The returned `start`/`end` are still
 * absolute UTC instants (safe to store/compare), they're just computed
 * from local-calendar-day boundaries in the right zone.
 */

export type TimeOfDay = 'morning' | 'afternoon'

// "de manhã" / "de tarde" business-hours windows, per the n8n workflow
// spec this resolver mirrors. Deliberately not configurable per call —
// callers that need account-specific hours narrow further downstream
// against `calendar_configs.business_hours`.
const TIME_OF_DAY_WINDOWS: Record<TimeOfDay, { startHour: number; endHour: number }> = {
  morning: { startHour: 9, endHour: 13 },
  afternoon: { startHour: 14, endHour: 19 },
}

export interface ResolvedDateRange {
  /** Absolute UTC instant for the start of the resolved range. */
  start: Date
  /** Absolute UTC instant for the end of the resolved range. */
  end: Date
  /**
   * 'exact'  — a single specific day (or day+time-of-day window) was
   *            requested: "amanhã", "daqui a 3 dias", an explicit date.
   * 'range'  — a multi-day span was requested: "próxima semana",
   *            "nos próximos 5 dias", "próximo mês".
   */
  precision: 'exact' | 'range'
  /** Which rule matched — useful for logging/debugging the agent. */
  rule: string
  /** Whether an explicit user-given date overrode relative phrases. */
  source: 'explicit' | 'relative'
}

// Keys are already diacritic-stripped ASCII — matched against
// `normalize()`'s output, never against raw accented text. This sidesteps
// a real bug: `\b` in a non-unicode JS RegExp only recognizes
// `[A-Za-z0-9_]` as "word" characters, so `\bamanh[ãa]\b` silently fails
// to match "amanhã?" (the boundary after "ã" never fires, since neither
// "ã" nor "?" is a word char). Stripping accents first means every
// pattern below is plain ASCII and `\b` behaves as expected.
const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  'terca-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
}

const MONTHS: Record<string, number> = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
}

/**
 * Lowercase, trim, and strip diacritics (á→a, ã→a, ç→c, ...) via Unicode
 * NFD decomposition. All matching below happens against this normalized,
 * accent-free form — see the note on `WEEKDAYS` for why.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Local midnight (start of day) for a TZDate, in its own timezone. */
function localStartOfDay(d: TZDate): Date {
  return startOfDay(d)
}

function localEndOfDay(d: TZDate): Date {
  return endOfDay(d)
}

function applyTimeOfDay(day: TZDate, timeOfDay: TimeOfDay, timezone: string): ResolvedDateRange {
  const { startHour, endHour } = TIME_OF_DAY_WINDOWS[timeOfDay]
  const y = day.getFullYear()
  const m = day.getMonth()
  const d = day.getDate()
  const start = new TZDate(y, m, d, startHour, 0, 0, timezone)
  const end = new TZDate(y, m, d, endHour, 0, 0, timezone)
  return { start, end, precision: 'exact', rule: `time-of-day:${timeOfDay}`, source: 'relative' }
}

/**
 * Try to find an explicit, user-given date in `text`. Explicit dates
 * always win over relative phrases (per spec). Supports:
 *   - ISO: 2026-08-20
 *   - PT numeric: 20/08/2026, 20-08-2026, 20/08 (year defaults to the
 *     next occurrence of that day/month from `now`)
 *   - PT written: "20 de agosto", "20 de agosto de 2026"
 */
function findExplicitDate(text: string, now: TZDate, timezone: string): TZDate | null {
  const norm = normalize(text)

  // ISO: yyyy-mm-dd
  const iso = norm.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) {
    const [, y, m, d] = iso
    const candidate = new TZDate(Number(y), Number(m) - 1, Number(d), 0, 0, 0, timezone)
    if (isValid(candidate)) return candidate
  }

  // Written: "20 de agosto [de 2026]"
  const written = norm.match(
    /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/,
  )
  if (written) {
    const [, dayStr, monthName, yearStr] = written
    const month = MONTHS[monthName]
    const day = Number(dayStr)
    let year = yearStr ? Number(yearStr) : now.getFullYear()
    let candidate = new TZDate(year, month, day, 0, 0, 0, timezone)
    // No year given and the date already passed this year → assume next year.
    if (!yearStr && candidate < localStartOfDay(now)) {
      year += 1
      candidate = new TZDate(year, month, day, 0, 0, 0, timezone)
    }
    if (isValid(candidate)) return candidate
  }

  // Numeric PT: dd/mm[/yyyy] or dd-mm[-yyyy] (day first, PT-PT convention)
  const numeric = norm.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  if (numeric) {
    const [, dayStr, monthStr, yearStr] = numeric
    const day = Number(dayStr)
    const month = Number(monthStr) - 1
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let year = yearStr ? (yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr)) : now.getFullYear()
      let candidate = new TZDate(year, month, day, 0, 0, 0, timezone)
      if (!yearStr && candidate < localStartOfDay(now)) {
        year += 1
        candidate = new TZDate(year, month, day, 0, 0, 0, timezone)
      }
      if (isValid(candidate)) return candidate
    }
  }

  return null
}

function findTimeOfDay(text: string): TimeOfDay | null {
  const norm = normalize(text)
  if (/\bde\s+manha\b/.test(norm)) return 'morning'
  if (/\bde\s+tarde\b/.test(norm)) return 'afternoon'
  return null
}

/**
 * Resolve a PT-PT natural-language date/time expression against a
 * reference instant and an IANA timezone. Returns `null` when no
 * recognizable expression is found (caller should fall back to asking
 * the user, never to guessing).
 */
export function resolveDate(text: string, referenceDate: Date, timezone: string): ResolvedDateRange | null {
  const norm = normalize(text)
  const now = new TZDate(referenceDate.getTime(), timezone)
  const timeOfDay = findTimeOfDay(text)

  // 1) Explicit date always wins over relative phrases.
  const explicit = findExplicitDate(text, now, timezone)
  if (explicit) {
    if (timeOfDay) return { ...applyTimeOfDay(explicit, timeOfDay, timezone), source: 'explicit' }
    return {
      start: localStartOfDay(explicit),
      end: localEndOfDay(explicit),
      precision: 'exact',
      rule: 'explicit-date',
      source: 'explicit',
    }
  }

  // 2) "depois de amanhã" (check before "amanhã" — it's a superstring)
  if (/\bdepois\s+de\s+amanha\b/.test(norm)) {
    const day = addDays(now, 2)
    if (timeOfDay) return applyTimeOfDay(day, timeOfDay, timezone)
    return {
      start: localStartOfDay(day),
      end: localEndOfDay(day),
      precision: 'exact',
      rule: 'depois-de-amanha',
      source: 'relative',
    }
  }

  // 3) "amanhã"
  if (/\bamanha\b/.test(norm)) {
    const day = addDays(now, 1)
    if (timeOfDay) return applyTimeOfDay(day, timeOfDay, timezone)
    return {
      start: localStartOfDay(day),
      end: localEndOfDay(day),
      precision: 'exact',
      rule: 'amanha',
      source: 'relative',
    }
  }

  // 4) "daqui a X dias" — exactly (hoje + X)
  const daquiAX = norm.match(/\bdaqui\s+a\s+(\d+)\s+dias?\b/)
  if (daquiAX) {
    const n = Number(daquiAX[1])
    const day = addDays(now, n)
    if (timeOfDay) return applyTimeOfDay(day, timeOfDay, timezone)
    return {
      start: localStartOfDay(day),
      end: localEndOfDay(day),
      precision: 'exact',
      rule: 'daqui-a-x-dias',
      source: 'relative',
    }
  }

  // 5) "nos próximos X dias" — (hoje+1) → (hoje+X)
  const proximosXDias = norm.match(/\bnos?\s+proximos?\s+(\d+)\s+dias?\b/)
  if (proximosXDias) {
    const n = Number(proximosXDias[1])
    return {
      start: localStartOfDay(addDays(now, 1)),
      end: localEndOfDay(addDays(now, n)),
      precision: 'range',
      rule: 'proximos-x-dias',
      source: 'relative',
    }
  }

  // 6) "próximo mês" / "mês que vem" — 1º dia → último dia desse mês
  if (/\bproximo\s+mes\b/.test(norm) || /\bmes\s+que\s+vem\b/.test(norm)) {
    const nextMonth = addMonths(now, 1)
    return {
      start: startOfMonth(nextMonth),
      end: endOfMonth(nextMonth),
      precision: 'range',
      rule: 'proximo-mes',
      source: 'relative',
    }
  }

  // 7) "próxima semana" / "para a semana" / "semana que vem" —
  //    (hoje+1) → (hoje+7)
  if (
    /\bproxima\s+semana\b/.test(norm) ||
    /\bpara\s+a\s+semana\b/.test(norm) ||
    /\bsemana\s+que\s+vem\b/.test(norm)
  ) {
    return {
      start: localStartOfDay(addDays(now, 1)),
      end: localEndOfDay(addDays(now, 7)),
      precision: 'range',
      rule: 'proxima-semana',
      source: 'relative',
    }
  }

  // 8) Weekday name — next occurrence strictly after today (e.g.
  //    "segunda-feira" said on a Monday means *next* Monday, not today).
  for (const [name, targetDow] of Object.entries(WEEKDAYS)) {
    const re = new RegExp(`\\b(?:proxim[ao]\\s+)?${name}\\b`)
    if (re.test(norm)) {
      const currentDow = now.getDay()
      let delta = (targetDow - currentDow + 7) % 7
      if (delta === 0) delta = 7
      const day = addDays(now, delta)
      if (timeOfDay) return applyTimeOfDay(day, timeOfDay, timezone)
      return {
        start: localStartOfDay(day),
        end: localEndOfDay(day),
        precision: 'exact',
        rule: `weekday:${name}`,
        source: 'relative',
      }
    }
  }

  // 9) Bare time-of-day with no date phrase → today.
  if (timeOfDay) {
    return { ...applyTimeOfDay(now, timeOfDay, timezone), rule: `time-of-day:${timeOfDay}:today` }
  }

  // 10) "hoje"
  if (/\bhoje\b/.test(norm)) {
    return {
      start: localStartOfDay(now),
      end: localEndOfDay(now),
      precision: 'exact',
      rule: 'hoje',
      source: 'relative',
    }
  }

  return null
}
