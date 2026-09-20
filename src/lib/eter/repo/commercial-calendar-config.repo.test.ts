import { describe, it, expect } from 'vitest'
import { getCommercialCalendarConfig } from './commercial-calendar-config.repo'

function row(overrides: Record<string, unknown> = {}) {
  return {
    commercial_calendar_id: 'leads@group.calendar.google.com',
    commercial_busy_calendar_ids: ['primary'],
    commercial_meeting_duration_min: 30,
    commercial_timezone: 'Europe/Lisbon',
    commercial_business_hours: { mon: [['09:00', '18:00']] },
    commercial_min_lead_time_min: 120,
    commercial_buffer_min: 15,
    commercial_max_business_days_ahead: 10,
    ...overrides,
  }
}

function makeDb(data: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error: null }),
        }),
      }),
    }),
  } as never
}

describe('getCommercialCalendarConfig', () => {
  it('returns null when the account has no ai_configs row at all', async () => {
    const config = await getCommercialCalendarConfig(makeDb(null), 'acct-1')
    expect(config).toBeNull()
  })

  it('always includes calendarId in busyCalendarIds even if the stored list omits it', async () => {
    const config = await getCommercialCalendarConfig(makeDb(row()), 'acct-1')
    expect(config?.busyCalendarIds).toEqual(
      expect.arrayContaining(['primary', 'leads@group.calendar.google.com']),
    )
  })

  it('de-duplicates busyCalendarIds when the stored list already includes the destination calendar', async () => {
    const config = await getCommercialCalendarConfig(
      makeDb(row({ commercial_busy_calendar_ids: ['primary', 'leads@group.calendar.google.com'] })),
      'acct-1',
    )
    expect(config?.busyCalendarIds.sort()).toEqual(
      ['leads@group.calendar.google.com', 'primary'].sort(),
    )
  })

  it('returns calendarId null and no synthetic addition when nothing is configured', async () => {
    const config = await getCommercialCalendarConfig(
      makeDb(row({ commercial_calendar_id: null, commercial_busy_calendar_ids: [] })),
      'acct-1',
    )
    expect(config?.calendarId).toBeNull()
    expect(config?.busyCalendarIds).toEqual([])
  })

  it('filters out non-string/blank entries defensively', async () => {
    const config = await getCommercialCalendarConfig(
      makeDb(row({ commercial_busy_calendar_ids: ['primary', '', null as never] })),
      'acct-1',
    )
    expect(config?.busyCalendarIds).toEqual(
      expect.arrayContaining(['primary', 'leads@group.calendar.google.com']),
    )
    expect(config?.busyCalendarIds).toHaveLength(2)
  })
})
