import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  getCalendarConfig: vi.fn(),
  findConfirmedBookingsInRange: vi.fn(),
  createAccountCalendarClient: vi.fn(),
}))
vi.mock('@/lib/eter/repo/calendar-config.repo', () => ({
  getCalendarConfig: h.getCalendarConfig,
}))
vi.mock('@/lib/eter/repo/bookings.repo', () => ({
  findConfirmedBookingsInRange: h.findConfirmedBookingsInRange,
}))
vi.mock('@/lib/calendar/google/account-client', () => ({
  createAccountCalendarClient: h.createAccountCalendarClient,
}))

import { checkAvailabilityHandler } from './check-availability'
import type { ToolHandlerContext } from './context'

const ctx: ToolHandlerContext = {
  db: {} as SupabaseClient,
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  defaultNotifyUserId: null,
}

describe('checkAvailabilityHandler', () => {
  it('rejects a range wider than the hard cap without touching the calendar or DB', async () => {
    const result = await checkAvailabilityHandler(ctx, {
      range_start: '2026-01-01T00:00:00Z',
      range_end: '2036-01-01T00:00:00Z', // 10 years
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('demasiado grande')
    expect(h.getCalendarConfig).not.toHaveBeenCalled()
    expect(h.createAccountCalendarClient).not.toHaveBeenCalled()
  })

  it('rejects range_end before range_start', async () => {
    const result = await checkAvailabilityHandler(ctx, {
      range_start: '2026-08-21T00:00:00Z',
      range_end: '2026-08-20T00:00:00Z',
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('depois de')
  })

  it('reports a clean error when there is no active calendar config', async () => {
    h.getCalendarConfig.mockResolvedValueOnce(null)
    const result = await checkAvailabilityHandler(ctx, {
      range_start: '2026-08-20T00:00:00Z',
      range_end: '2026-08-21T00:00:00Z',
    })
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/não há/i)
  })

  it('accepts a range within the cap and calls through to Google + bookings', async () => {
    h.getCalendarConfig.mockResolvedValueOnce({
      timezone: 'Europe/Lisbon',
      businessHours: { thu: [['09:00', '18:00']] },
      bufferMin: 0,
      minLeadTimeMin: 0,
      defaultDurationMin: 30,
      isActive: true,
    })
    h.findConfirmedBookingsInRange.mockResolvedValueOnce([])
    h.createAccountCalendarClient.mockResolvedValueOnce({
      getBusySlots: vi.fn().mockResolvedValue([]),
    })

    const result = await checkAvailabilityHandler(ctx, {
      range_start: '2026-08-20T00:00:00Z',
      range_end: '2026-08-27T00:00:00Z', // 7 days, within cap
    })
    expect(result.isError).toBe(false)
    expect(h.getCalendarConfig).toHaveBeenCalledWith(ctx.db, 'acct-1')
    const parsed = JSON.parse(result.content)
    expect(parsed.timezone).toBe('Europe/Lisbon')
  })
})
