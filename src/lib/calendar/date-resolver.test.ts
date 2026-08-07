import { describe, expect, it } from 'vitest'
import { resolveDate } from './date-resolver'

const TZ = 'Europe/Lisbon'

// Reference: Wednesday 2026-08-05, 10:00 local (Europe/Lisbon, WEST/UTC+1).
const REF = new Date('2026-08-05T09:00:00.000Z')

function ymd(d: Date, timezone = TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

describe('resolveDate', () => {
  it('returns null for text with no date expression', () => {
    expect(resolveDate('quero saber mais sobre os vossos serviços', REF, TZ)).toBeNull()
  })

  it('resolves "amanhã" to exactly tomorrow', () => {
    const r = resolveDate('podemos falar amanhã?', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.precision).toBe('exact')
    expect(ymd(r!.start)).toBe('2026-08-06')
    expect(ymd(r!.end)).toBe('2026-08-06')
  })

  it('resolves "depois de amanhã" to the day after tomorrow (not "amanhã")', () => {
    const r = resolveDate('marca para depois de amanhã', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.rule).toBe('depois-de-amanha')
    expect(ymd(r!.start)).toBe('2026-08-07')
  })

  it('resolves "daqui a 5 dias" to exactly hoje+5', () => {
    const r = resolveDate('daqui a 5 dias fica bem', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.precision).toBe('exact')
    expect(ymd(r!.start)).toBe('2026-08-10')
    expect(ymd(r!.end)).toBe('2026-08-10')
  })

  it('resolves "nos próximos 3 dias" to a (hoje+1)→(hoje+3) range', () => {
    const r = resolveDate('tenho disponibilidade nos próximos 3 dias', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.precision).toBe('range')
    expect(ymd(r!.start)).toBe('2026-08-06')
    expect(ymd(r!.end)).toBe('2026-08-08')
  })

  it('resolves "próxima semana" to a (hoje+1)→(hoje+7) range', () => {
    const r = resolveDate('podemos ver isso na próxima semana', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.precision).toBe('range')
    expect(ymd(r!.start)).toBe('2026-08-06')
    expect(ymd(r!.end)).toBe('2026-08-12')
  })

  it('resolves "para a semana" the same as "próxima semana"', () => {
    const r = resolveDate('fica para a semana', REF, TZ)
    expect(r).not.toBeNull()
    expect(ymd(r!.start)).toBe('2026-08-06')
    expect(ymd(r!.end)).toBe('2026-08-12')
  })

  it('resolves "próximo mês" to the first→last day of next month', () => {
    const r = resolveDate('só temos tempo no próximo mês', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.precision).toBe('range')
    expect(ymd(r!.start)).toBe('2026-09-01')
    expect(ymd(r!.end)).toBe('2026-09-30')
  })

  it('resolves a bare weekday to its next occurrence (not today, even if today matches)', () => {
    // REF is a Wednesday. Asking for "quarta-feira" should skip today
    // and land on the following Wednesday.
    const r = resolveDate('pode ser quarta-feira?', REF, TZ)
    expect(r).not.toBeNull()
    expect(ymd(r!.start)).toBe('2026-08-12')
  })

  it('resolves "segunda-feira" to the upcoming Monday', () => {
    const r = resolveDate('segunda-feira dá jeito', REF, TZ)
    expect(r).not.toBeNull()
    expect(ymd(r!.start)).toBe('2026-08-10')
  })

  it('narrows to the morning window (09-13) with "de manhã"', () => {
    const r = resolveDate('amanhã de manhã', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.rule).toBe('time-of-day:morning')
    const startHour = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(
      r!.start,
    )
    const endHour = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(
      r!.end,
    )
    expect(startHour).toBe('09')
    expect(endHour).toBe('13')
    expect(ymd(r!.start)).toBe('2026-08-06')
  })

  it('narrows to the afternoon window (14-19) with "de tarde"', () => {
    const r = resolveDate('depois de amanhã de tarde', REF, TZ)
    expect(r).not.toBeNull()
    expect(ymd(r!.start)).toBe('2026-08-07')
    const startHour = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(
      r!.start,
    )
    expect(startHour).toBe('14')
  })

  it('an explicit ISO date overrides a relative phrase in the same message', () => {
    // Even though "amanhã" appears, an explicit date must win.
    const r = resolveDate('não é amanhã, é dia 2026-08-20', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.source).toBe('explicit')
    expect(ymd(r!.start)).toBe('2026-08-20')
  })

  it('resolves an explicit PT numeric date (dd/mm)', () => {
    const r = resolveDate('dia 20/08 fica bem', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.source).toBe('explicit')
    expect(ymd(r!.start)).toBe('2026-08-20')
  })

  it('resolves an explicit written PT date ("20 de agosto")', () => {
    const r = resolveDate('pode ser 20 de agosto?', REF, TZ)
    expect(r).not.toBeNull()
    expect(r!.source).toBe('explicit')
    expect(ymd(r!.start)).toBe('2026-08-20')
  })

  it('rolls an explicit dd/mm date without a year to next year when it already passed', () => {
    // REF is 2026-08-05. "10/03" (March 10) has already passed this
    // year, so it must resolve to 2027-03-10, not 2026-03-10.
    const r = resolveDate('dia 10/03', REF, TZ)
    expect(r).not.toBeNull()
    expect(ymd(r!.start)).toBe('2027-03-10')
  })

  it('resolves "hoje" to today', () => {
    const r = resolveDate('podemos falar hoje?', REF, TZ)
    expect(r).not.toBeNull()
    expect(ymd(r!.start)).toBe('2026-08-05')
  })

  it('resolves consistently across timezones (same wall-clock phrase, different zone)', () => {
    const lisbon = resolveDate('amanhã', REF, 'Europe/Lisbon')!
    const saoPaulo = resolveDate('amanhã', REF, 'America/Sao_Paulo')!
    // Both must land on "tomorrow" in their own local calendar, even
    // though the underlying UTC instants differ.
    expect(ymd(lisbon.start, 'Europe/Lisbon')).toBe('2026-08-06')
    expect(ymd(saoPaulo.start, 'America/Sao_Paulo')).toBe('2026-08-06')
    expect(lisbon.start.getTime()).not.toBe(saoPaulo.start.getTime())
  })
})
