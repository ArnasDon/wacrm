import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Booking } from './repo/bookings.repo'

const h = vi.hoisted(() => ({
  scheduleMessages: vi.fn(),
  cancelScheduledMessagesForConversation: vi.fn(),
  cancelRemindersForBooking: vi.fn(),
  getLastInboundMessageText: vi.fn(),
}))

vi.mock('./repo/scheduled-messages.repo', async () => {
  const actual = await vi.importActual<typeof import('./repo/scheduled-messages.repo')>(
    './repo/scheduled-messages.repo',
  )
  return {
    ...actual,
    scheduleMessages: h.scheduleMessages,
    cancelScheduledMessagesForConversation: h.cancelScheduledMessagesForConversation,
    cancelRemindersForBooking: h.cancelRemindersForBooking,
  }
})
vi.mock('./repo/messages.repo', () => ({
  getLastInboundMessageText: h.getLastInboundMessageText,
}))

import { scheduleFollowUpCadence, cancelFollowUpCadence, scheduleMeetingReminders } from './followups'
import { FOLLOW_UP_KINDS } from './repo/scheduled-messages.repo'

const db = {} as SupabaseClient

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    accountId: 'acct-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    externalEventId: 'evt-1',
    startsAt: new Date('2026-08-25T10:00:00Z'),
    endsAt: new Date('2026-08-25T10:30:00Z'),
    status: 'confirmed',
    service: null,
    notes: null,
    ...overrides,
  }
}

describe('scheduleFollowUpCadence', () => {
  it('cancels any existing pending cadence, then schedules exactly the T+1/T+3/T+7 rows', async () => {
    h.getLastInboundMessageText.mockResolvedValue('será que dá para falar amanhã?')
    h.cancelScheduledMessagesForConversation.mockResolvedValue(3)
    h.scheduleMessages.mockResolvedValue([])

    const now = new Date('2026-08-19T09:00:00Z')
    await scheduleFollowUpCadence(db, 'acct-1', { conversationId: 'conv-1', contactId: 'contact-1' }, now)

    expect(h.cancelScheduledMessagesForConversation).toHaveBeenCalledWith(db, 'acct-1', 'conv-1', {
      kinds: FOLLOW_UP_KINDS,
    })
    expect(h.scheduleMessages).toHaveBeenCalledTimes(1)
    const [, , inputs] = h.scheduleMessages.mock.calls[0]
    expect(inputs).toHaveLength(3)
    expect(inputs.map((i: { kind: string }) => i.kind)).toEqual(['follow_up_1d', 'follow_up_3d', 'follow_up_7d'])
    expect(inputs[0].sendAt.toISOString()).toBe('2026-08-20T09:00:00.000Z')
    expect(inputs[1].sendAt.toISOString()).toBe('2026-08-22T09:00:00.000Z')
    expect(inputs[2].sendAt.toISOString()).toBe('2026-08-26T09:00:00.000Z')
    // T+1 references the lead's last message — "referencing what was
    // being discussed" per the brief.
    expect(inputs[0].payload.freeText).toContain('falar amanhã')
  })

  it('is terminal at T+7 — never schedules a 4th step', async () => {
    h.getLastInboundMessageText.mockResolvedValue(null)
    h.cancelScheduledMessagesForConversation.mockResolvedValue(0)
    h.scheduleMessages.mockResolvedValue([])

    await scheduleFollowUpCadence(db, 'acct-1', { conversationId: 'conv-1', contactId: null }, new Date())

    const [, , inputs] = h.scheduleMessages.mock.calls[0]
    expect(inputs).toHaveLength(3)
    expect(new Set(inputs.map((i: { kind: string }) => i.kind))).toEqual(
      new Set(['follow_up_1d', 'follow_up_3d', 'follow_up_7d']),
    )
  })
})

describe('cancelFollowUpCadence', () => {
  it('cancels only the follow-up kinds for the conversation', async () => {
    h.cancelScheduledMessagesForConversation.mockResolvedValue(2)
    await cancelFollowUpCadence(db, 'acct-1', 'conv-1')
    expect(h.cancelScheduledMessagesForConversation).toHaveBeenCalledWith(db, 'acct-1', 'conv-1', {
      kinds: FOLLOW_UP_KINDS,
    })
  })
})

describe('scheduleMeetingReminders', () => {
  it('cancels existing reminders for the booking, then schedules T-24h and T-2h', async () => {
    h.cancelRemindersForBooking.mockResolvedValue(0)
    h.scheduleMessages.mockResolvedValue([])

    const now = new Date('2026-08-01T00:00:00Z')
    await scheduleMeetingReminders(db, 'acct-1', booking(), now)

    expect(h.cancelRemindersForBooking).toHaveBeenCalledWith(db, 'acct-1', 'bk-1')
    const [, , inputs] = h.scheduleMessages.mock.calls[0]
    expect(inputs.map((i: { kind: string }) => i.kind).sort()).toEqual(['reminder_24h', 'reminder_2h'])
    expect(inputs.every((i: { bookingId: string }) => i.bookingId === 'bk-1')).toBe(true)
  })

  it('skips reminders whose fire time has already passed (booked too close to the meeting)', async () => {
    h.cancelRemindersForBooking.mockResolvedValue(0)
    h.scheduleMessages.mockResolvedValue([])

    // "now" is 1h before the meeting — both T-24h and T-2h are already in the past.
    const now = new Date('2026-08-25T09:00:00Z')
    await scheduleMeetingReminders(db, 'acct-1', booking(), now)

    expect(h.scheduleMessages).not.toHaveBeenCalled()
  })

  it('schedules only the reminder(s) still in the future', async () => {
    h.cancelRemindersForBooking.mockResolvedValue(0)
    h.scheduleMessages.mockResolvedValue([])

    // 3h before the meeting: T-24h is in the past, T-2h is still ahead.
    const now = new Date('2026-08-25T07:00:00Z')
    await scheduleMeetingReminders(db, 'acct-1', booking(), now)

    const [, , inputs] = h.scheduleMessages.mock.calls[0]
    expect(inputs).toHaveLength(1)
    expect(inputs[0].kind).toBe('reminder_2h')
  })
})
