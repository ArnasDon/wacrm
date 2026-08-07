import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  getCalendarConfig: vi.fn(),
  setCalendarConfigActive: vi.fn(),
  updateCalendarConfigRefreshToken: vi.fn(),
  createBooking: vi.fn(),
  getBooking: vi.fn(),
  updateBooking: vi.fn(),
  resolvePendingAction: vi.fn(),
  attachResultingBooking: vi.fn(),
  createAccountCalendarClient: vi.fn(),
  createAgentNotification: vi.fn(),
  loadAiConfig: vi.fn(),
}))
vi.mock('@/lib/eter/repo/calendar-config.repo', () => ({
  getCalendarConfig: h.getCalendarConfig,
  setCalendarConfigActive: h.setCalendarConfigActive,
  updateCalendarConfigRefreshToken: h.updateCalendarConfigRefreshToken,
}))
vi.mock('@/lib/eter/repo/bookings.repo', () => ({
  createBooking: h.createBooking,
  getBooking: h.getBooking,
  updateBooking: h.updateBooking,
}))
vi.mock('@/lib/eter/repo/pending-actions.repo', () => ({
  resolvePendingAction: h.resolvePendingAction,
  attachResultingBooking: h.attachResultingBooking,
}))
vi.mock('@/lib/eter/repo/notifications.repo', () => ({
  createAgentNotification: h.createAgentNotification,
}))
vi.mock('@/lib/ai/config', () => ({
  loadAiConfig: h.loadAiConfig,
}))
vi.mock('@/lib/calendar/google/account-client', () => ({
  createAccountCalendarClient: h.createAccountCalendarClient,
}))

import { CalendarError } from '@/lib/calendar/google/client'
import { confirmPendingAction, PendingActionError } from './confirm-pending-action'

const db = {} as SupabaseClient

function pendingAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa-1',
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    toolName: 'book_meeting',
    toolInput: {
      contact_id: 'contact-1',
      starts_at: '2026-08-20T09:00:00Z',
      ends_at: '2026-08-20T09:30:00Z',
      service: 'Demo',
    },
    status: 'confirmed', // resolvePendingAction returns the POST-claim row
    resolvedAt: new Date(),
    resultingBookingId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function activeConfig() {
  return { calendarId: 'primary', timezone: 'Europe/Lisbon', isActive: true }
}

describe('confirmPendingAction — concurrency (write-gate second half)', () => {
  it('claims atomically BEFORE touching Google Calendar, and never calls createEvent when the claim fails', async () => {
    h.resolvePendingAction.mockRejectedValueOnce(new Error('no row matched — already resolved'))

    await expect(confirmPendingAction(db, 'acct-1', 'pa-1')).rejects.toBeInstanceOf(PendingActionError)
    expect(h.getCalendarConfig).not.toHaveBeenCalled()
    expect(h.createAccountCalendarClient).not.toHaveBeenCalled()
  })

  it('a second concurrent confirmation for the same id is rejected without a second calendar event', async () => {
    // First call claims successfully...
    h.resolvePendingAction.mockResolvedValueOnce(pendingAction())
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    const createEvent = vi.fn().mockResolvedValue({ id: 'evt-1' })
    h.createAccountCalendarClient.mockResolvedValue({ createEvent, rotatedRefreshToken: null })
    h.createBooking.mockResolvedValue({ id: 'bk-1' })

    const first = confirmPendingAction(db, 'acct-1', 'pa-1')

    // ...the second call's claim attempt fails because the row is no
    // longer `pending` (this is what the repo's `.eq('status','pending')`
    // guarantees at the DB level — simulated here by rejecting).
    h.resolvePendingAction.mockRejectedValueOnce(new Error('no row matched'))
    const second = confirmPendingAction(db, 'acct-1', 'pa-1')

    await expect(first).resolves.toEqual({ bookingId: 'bk-1' })
    await expect(second).rejects.toBeInstanceOf(PendingActionError)
    expect(createEvent).toHaveBeenCalledTimes(1) // NOT 2 — no double-booking
  })
})

describe('confirmPendingAction — tool_input validation', () => {
  it('throws a clean PendingActionError instead of creating an Invalid-Date event for a corrupt row', async () => {
    h.resolvePendingAction.mockResolvedValueOnce(
      pendingAction({ toolInput: { contact_id: 'contact-1' /* missing starts_at/ends_at */ } }),
    )
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    const createEvent = vi.fn()
    h.createAccountCalendarClient.mockResolvedValue({ createEvent, rotatedRefreshToken: null })

    await expect(confirmPendingAction(db, 'acct-1', 'pa-1')).rejects.toMatchObject({
      code: 'invalid_pending_input',
    })
    expect(createEvent).not.toHaveBeenCalled()
  })

  it('books the meeting and attaches the resulting booking id on success', async () => {
    h.resolvePendingAction.mockResolvedValueOnce(pendingAction())
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    h.createAccountCalendarClient.mockResolvedValue({
      createEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      rotatedRefreshToken: null,
    })
    h.createBooking.mockResolvedValue({ id: 'bk-1' })

    const result = await confirmPendingAction(db, 'acct-1', 'pa-1')
    expect(result).toEqual({ bookingId: 'bk-1' })
    expect(h.attachResultingBooking).toHaveBeenCalledWith(db, 'acct-1', 'pa-1', 'bk-1')
  })

  it('persists a rotated refresh token when Google returns one', async () => {
    h.resolvePendingAction.mockResolvedValueOnce(pendingAction())
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    h.createAccountCalendarClient.mockResolvedValue({
      createEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      rotatedRefreshToken: 'rt-NEW',
    })
    h.createBooking.mockResolvedValue({ id: 'bk-1' })

    await confirmPendingAction(db, 'acct-1', 'pa-1')
    expect(h.updateCalendarConfigRefreshToken).toHaveBeenCalledWith(db, 'acct-1', 'rt-NEW')
  })
})

describe('confirmPendingAction — revoked Google grant resilience', () => {
  it('deactivates the calendar config, notifies the handoff agent, and reports calendar_revoked (not a generic error)', async () => {
    h.resolvePendingAction.mockResolvedValueOnce(pendingAction())
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    h.createAccountCalendarClient.mockRejectedValueOnce(
      new CalendarError('Google Calendar API error (400): invalid_grant', { code: 'google_error', status: 400 }),
    )
    h.loadAiConfig.mockResolvedValue({ handoffAgentId: 'user-42' })

    const err = await confirmPendingAction(db, 'acct-1', 'pa-1').catch((e) => e)
    expect(err).toBeInstanceOf(PendingActionError)
    expect(err).toMatchObject({ code: 'calendar_revoked' })

    expect(h.setCalendarConfigActive).toHaveBeenCalledWith(db, 'acct-1', false)
    expect(h.createAgentNotification).toHaveBeenCalledWith(
      db,
      'acct-1',
      expect.objectContaining({ userId: 'user-42' }),
    )
  })

  it('does not write a booking when the revoked grant is detected mid-createEvent', async () => {
    h.resolvePendingAction.mockResolvedValueOnce(pendingAction())
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    const createEvent = vi
      .fn()
      .mockRejectedValueOnce(
        new CalendarError('Google Calendar API error (401)', { code: 'invalid_token', status: 401 }),
      )
    h.createAccountCalendarClient.mockResolvedValue({ createEvent, rotatedRefreshToken: null })
    h.loadAiConfig.mockResolvedValue({ handoffAgentId: 'user-42' })

    await expect(confirmPendingAction(db, 'acct-1', 'pa-1')).rejects.toMatchObject({
      code: 'calendar_revoked',
    })
    expect(h.createBooking).not.toHaveBeenCalled()
    expect(h.setCalendarConfigActive).toHaveBeenCalledWith(db, 'acct-1', false)
  })

  it('still reports calendar_revoked even when no handoff agent is configured to notify', async () => {
    h.resolvePendingAction.mockResolvedValueOnce(pendingAction())
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    h.createAccountCalendarClient.mockRejectedValueOnce(
      new CalendarError('invalid_grant', { code: 'invalid_token', status: 401 }),
    )
    h.loadAiConfig.mockResolvedValue({ handoffAgentId: null })

    await expect(confirmPendingAction(db, 'acct-1', 'pa-1')).rejects.toMatchObject({
      code: 'calendar_revoked',
    })
    expect(h.createAgentNotification).not.toHaveBeenCalled()
    expect(h.setCalendarConfigActive).toHaveBeenCalledWith(db, 'acct-1', false)
  })

  it('does NOT treat a generic Google failure (e.g. 500) as a revoked grant', async () => {
    h.resolvePendingAction.mockResolvedValueOnce(pendingAction())
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    h.createAccountCalendarClient.mockRejectedValueOnce(
      new CalendarError('Google Calendar API error (500): upstream failure', { code: 'google_error', status: 502 }),
    )

    const err = await confirmPendingAction(db, 'acct-1', 'pa-1').catch((e) => e)
    expect(err).toBeInstanceOf(CalendarError)
    expect(h.setCalendarConfigActive).not.toHaveBeenCalled()
    expect(h.createAgentNotification).not.toHaveBeenCalled()
  })

  it('still reports calendar_revoked when the deactivate/notify side effects themselves fail', async () => {
    h.resolvePendingAction.mockResolvedValueOnce(pendingAction())
    h.getCalendarConfig.mockResolvedValue(activeConfig())
    h.createAccountCalendarClient.mockRejectedValueOnce(
      new CalendarError('invalid_grant', { code: 'invalid_token', status: 401 }),
    )
    h.setCalendarConfigActive.mockRejectedValueOnce(new Error('db unavailable'))
    h.loadAiConfig.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(confirmPendingAction(db, 'acct-1', 'pa-1')).rejects.toMatchObject({
      code: 'calendar_revoked',
    })
  })
})
