import { describe, expect, it } from 'vitest'
import { autoReplyScheduleForAccount, parseAutoReplySchedule, withinAiAttentionHours } from './auto-reply-schedule'

const schedule = { timeZone: 'America/Guatemala', startHour: 8, endHour: 20 }

describe('automatic attention schedule', () => {
  it.each([
    ['2026-10-15T13:59:59Z', false], // 07:59:59 Guatemala
    ['2026-10-15T14:00:00Z', true],
    ['2026-10-16T01:59:59Z', true],
    ['2026-10-16T02:00:00Z', false], // 20:00 Guatemala
    ['2026-10-16T06:00:00Z', false],
  ])('uses Guatemala time at both boundaries: %s', (instant, allowed) => {
    expect(withinAiAttentionHours(schedule, new Date(instant))).toBe(allowed)
  })
  it('preserves unrestricted accounts', () => {
    expect(parseAutoReplySchedule(null)).toBeNull()
    expect(withinAiAttentionHours(null, new Date('2026-10-16T06:00:00Z'))).toBe(true)
  })
  it.each([
    { ...schedule, timeZone: 'invalid/zone' },
    { ...schedule, startHour: 8, endHour: 8 },
    { ...schedule, startHour: 8.5 },
    { ...schedule, endHour: 25 },
    {},
  ])('rejects invalid policy instead of falling back to server time: %j', (raw) => {
    expect(() => parseAutoReplySchedule(raw)).toThrow()
  })
  it('enables the fixed window only for opted-in accounts', () => {
    expect(autoReplyScheduleForAccount({ feature_flags: ['ai_attention_hours_8_20'], timezone: 'America/Guatemala' })).toEqual(schedule)
    expect(autoReplyScheduleForAccount({ feature_flags: ['ai_voice_notes'] })).toBeNull()
    expect(autoReplyScheduleForAccount({ feature_flags: ['ai_attention_hours_8_20'] })?.timeZone).toBe('America/Guatemala')
  })
})


describe('overnight attention requested by Villa San Ricardo', () => {
  const overnight = { ...schedule, startHour: 20, endHour: 8 }
  it.each([
    ['2026-10-15T13:59:59Z', true],
    ['2026-10-15T14:00:00Z', false],
    ['2026-10-16T01:59:59Z', false],
    ['2026-10-16T02:00:00Z', true],
    ['2026-10-16T06:00:00Z', true],
  ])('crosses midnight and respects both boundaries: %s', (instant, allowed) => {
    expect(withinAiAttentionHours(overnight, new Date(instant))).toBe(allowed)
  })
  it('selects the overnight policy and rejects conflicting day/night flags', () => {
    expect(autoReplyScheduleForAccount({ feature_flags: ['ai_attention_hours_20_8'], timezone: schedule.timeZone })).toEqual(overnight)
    expect(() => autoReplyScheduleForAccount({ feature_flags: ['ai_attention_hours_20_8', 'ai_attention_hours_8_20'] })).toThrow('Conflicting')
  })
})
