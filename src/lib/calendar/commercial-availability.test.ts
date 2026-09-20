import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getCommercialCalendarConfig: vi.fn(),
  getFreeBusyForCalendars: vi.fn(),
  createEvent: vi.fn(),
  loadServiceAccountFromEnv: vi.fn(),
  commercialImpersonatedUserFromEnv: vi.fn(),
  getServiceAccountAccessToken: vi.fn(),
  createBooking: vi.fn(),
  findConfirmedBookingsInRange: vi.fn(),
}))

vi.mock('@/lib/eter/repo/commercial-calendar-config.repo', () => ({
  getCommercialCalendarConfig: h.getCommercialCalendarConfig,
}))
vi.mock('@/lib/eter/repo/bookings.repo', () => ({
  createBooking: h.createBooking,
  findConfirmedBookingsInRange: h.findConfirmedBookingsInRange,
}))
vi.mock('./google/service-account', () => ({
  loadServiceAccountFromEnv: h.loadServiceAccountFromEnv,
  commercialImpersonatedUserFromEnv: h.commercialImpersonatedUserFromEnv,
  getServiceAccountAccessToken: h.getServiceAccountAccessToken,
}))
vi.mock('./google/client', async () => {
  const actual = await vi.importActual<typeof import('./google/client')>('./google/client')
  return {
    ...actual,
    getFreeBusyForCalendars: h.getFreeBusyForCalendars,
    createEvent: h.createEvent,
  }
})

import {
  addBusinessDays,
  findCommercialSlots,
  bookCommercialSlot,
  CommercialCalendarNotConfiguredError,
} from './commercial-availability'
import type { CommercialCalendarConfig } from '@/lib/eter/repo/commercial-calendar-config.repo'

function config(overrides: Partial<CommercialCalendarConfig> = {}): CommercialCalendarConfig {
  return {
    calendarId: 'leads@group.calendar.google.com',
    busyCalendarIds: ['primary', 'leads@group.calendar.google.com'],
    meetingDurationMin: 30,
    timezone: 'Europe/Lisbon',
    businessHours: {
      mon: [['09:00', '18:00']],
      tue: [['09:00', '18:00']],
      wed: [['09:00', '18:00']],
      thu: [['09:00', '18:00']],
      fri: [['09:00', '18:00']],
    },
    minLeadTimeMin: 120,
    bufferMin: 15,
    maxBusinessDaysAhead: 10,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCommercialCalendarConfig.mockResolvedValue(config())
  h.loadServiceAccountFromEnv.mockReturnValue({ clientEmail: 'sa@x.com', privateKey: 'k' })
  h.commercialImpersonatedUserFromEnv.mockReturnValue('geral@etergrowth.com')
  h.getServiceAccountAccessToken.mockResolvedValue('at-1')
  h.getFreeBusyForCalendars.mockResolvedValue({ primary: [], 'leads@group.calendar.google.com': [] })
  h.findConfirmedBookingsInRange.mockResolvedValue([])
  h.createEvent.mockResolvedValue({ id: 'evt-1', htmlLink: 'https://calendar.google.com/evt-1' })
  h.createBooking.mockResolvedValue({ id: 'booking-1' })
})

describe('addBusinessDays', () => {
  it('skips weekends when advancing N business days', () => {
    // 2026-09-18 is a Friday.
    const friday = new Date('2026-09-18T10:00:00Z')
    const result = addBusinessDays(friday, 1, 'Europe/Lisbon')
    // +1 business day from Friday must land on Monday, not Saturday.
    expect(result.getUTCDay()).toBe(1) // Monday
  })

  it('advances 10 business days correctly across a full weekend span', () => {
    // 2026-09-14 is a Monday.
    const monday = new Date('2026-09-14T10:00:00Z')
    const result = addBusinessDays(monday, 10, 'Europe/Lisbon')
    // 10 business days from a Monday = the Monday two weeks later.
    expect(result.getUTCDay()).toBe(1)
  })
})

describe('findCommercialSlots', () => {
  it('throws CommercialCalendarNotConfiguredError when the account has no commercial_calendar_id', async () => {
    h.getCommercialCalendarConfig.mockResolvedValue(config({ calendarId: null }))
    await expect(findCommercialSlots({} as never, 'acct-1')).rejects.toBeInstanceOf(
      CommercialCalendarNotConfiguredError,
    )
    expect(h.getServiceAccountAccessToken).not.toHaveBeenCalled()
  })

  it('checks free/busy across every configured busy calendar', async () => {
    await findCommercialSlots({} as never, 'acct-1', new Date('2026-09-14T08:00:00Z'))
    expect(h.getFreeBusyForCalendars).toHaveBeenCalledWith(
      'at-1',
      ['primary', 'leads@group.calendar.google.com'],
      expect.any(Object),
      undefined,
    )
  })

  it('returns at most MAX_PROPOSED_SLOTS slots even when many are free', async () => {
    const { slots } = await findCommercialSlots({} as never, 'acct-1', new Date('2026-09-14T08:00:00Z'))
    expect(slots.length).toBeLessThanOrEqual(3)
    expect(slots.length).toBeGreaterThan(0)
  })

  it('excludes a slot that is busy on ANY of the checked calendars, including the personal one', async () => {
    // Monday 2026-09-14, business hours 09:00–18:00 Lisbon (UTC+2 in
    // September, DST). Block 09:00 Lisbon on the PERSONAL calendar only.
    h.getFreeBusyForCalendars.mockResolvedValue({
      primary: [{ start: new Date('2026-09-14T07:00:00Z'), end: new Date('2026-09-14T13:00:00Z') }],
      'leads@group.calendar.google.com': [],
    })
    const { slots } = await findCommercialSlots({} as never, 'acct-1', new Date('2026-09-14T05:00:00Z'))
    for (const slot of slots) {
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(new Date('2026-09-14T13:00:00Z').getTime())
    }
  })
})

describe('bookCommercialSlot', () => {
  const baseInput = {
    accountId: 'acct-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    leadEmail: 'lead@example.com',
    leadName: 'Lead Teste',
    start: new Date('2026-09-14T10:00:00Z'),
  }

  it('creates the event on the commercial calendar (never a personal one) and records a confirmed booking', async () => {
    const outcome = await bookCommercialSlot({} as never, baseInput)
    expect(outcome).toEqual({ status: 'booked', eventId: 'evt-1', htmlLink: 'https://calendar.google.com/evt-1' })

    expect(h.createEvent).toHaveBeenCalledWith(
      'at-1',
      'leads@group.calendar.google.com',
      expect.objectContaining({ attendeeEmails: ['lead@example.com'] }),
      undefined,
    )
    expect(h.createBooking).toHaveBeenCalledWith(
      {},
      'acct-1',
      expect.objectContaining({ status: 'confirmed', externalEventId: 'evt-1' }),
    )
  })

  it('returns a conflict (never throws, never books) when the slot is no longer free on any checked calendar', async () => {
    h.getFreeBusyForCalendars.mockResolvedValue({
      primary: [{ start: new Date('2026-09-14T09:30:00Z'), end: new Date('2026-09-14T10:30:00Z') }],
      'leads@group.calendar.google.com': [],
    })
    const outcome = await bookCommercialSlot({} as never, baseInput)
    expect(outcome).toEqual({ status: 'conflict' })
    expect(h.createEvent).not.toHaveBeenCalled()
    expect(h.createBooking).not.toHaveBeenCalled()
  })

  it('returns a conflict when this account already has a confirmed overlapping booking (eventual-consistency guard)', async () => {
    h.findConfirmedBookingsInRange.mockResolvedValue([
      { startsAt: new Date('2026-09-14T10:00:00Z'), endsAt: new Date('2026-09-14T10:30:00Z') },
    ])
    const outcome = await bookCommercialSlot({} as never, baseInput)
    expect(outcome).toEqual({ status: 'conflict' })
    expect(h.createEvent).not.toHaveBeenCalled()
  })

  it('returns not_configured instead of throwing when the account has no commercial calendar', async () => {
    h.getCommercialCalendarConfig.mockResolvedValue(config({ calendarId: null }))
    const outcome = await bookCommercialSlot({} as never, baseInput)
    expect(outcome).toEqual({ status: 'not_configured' })
    expect(h.getServiceAccountAccessToken).not.toHaveBeenCalled()
  })
})
