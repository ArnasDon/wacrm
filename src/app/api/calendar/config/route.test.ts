import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  getCalendarConfig: vi.fn(),
  upsertCalendarConfig: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) => Response.json({ error: (err as Error)?.message ?? 'error' }, { status: 500 })),
}))
vi.mock('@/lib/eter/repo/calendar-config.repo', () => ({
  getCalendarConfig: mocks.getCalendarConfig,
  upsertCalendarConfig: mocks.upsertCalendarConfig,
}))

import { GET, PATCH } from './route'

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'admin' as const,
  account: { id: 'account-1', name: 'Acme' },
}

function connectedConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    accountId: 'account-1',
    provider: 'google' as const,
    refreshToken: 'plaintext-rt-should-never-leak',
    calendarId: 'primary',
    timezone: 'Europe/Lisbon',
    businessHours: { mon: [['09:00', '13:00']] },
    defaultDurationMin: 30,
    bufferMin: 15,
    minLeadTimeMin: 60,
    isActive: false,
    ...overrides,
  }
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/calendar/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAccount.mockResolvedValue(context)
  mocks.requireRole.mockResolvedValue(context)
})

describe('GET /api/calendar/config', () => {
  it('returns connected:false with no config row', async () => {
    mocks.getCalendarConfig.mockResolvedValue(null)
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual({ connected: false })
  })

  it('returns the public shape and never leaks refreshToken', async () => {
    mocks.getCalendarConfig.mockResolvedValue(connectedConfig())
    const res = await GET()
    const body = await res.json()
    expect(body.connected).toBe(true)
    expect(body.calendarId).toBe('primary')
    expect(body.timezone).toBe('Europe/Lisbon')
    expect(body).not.toHaveProperty('refreshToken')
    expect(JSON.stringify(body)).not.toContain('plaintext-rt-should-never-leak')
  })
})

describe('PATCH /api/calendar/config', () => {
  it('rejects with 409 when there is no existing connection', async () => {
    mocks.getCalendarConfig.mockResolvedValue(null)
    const res = await PATCH(patchRequest({ isActive: true }))
    expect(res.status).toBe(409)
    expect(mocks.upsertCalendarConfig).not.toHaveBeenCalled()
  })

  it('rejects invalid businessHours with 400 and does not write', async () => {
    mocks.getCalendarConfig.mockResolvedValue(connectedConfig())
    const res = await PATCH(patchRequest({ businessHours: { mon: [['25:00', '13:00']] } }))
    expect(res.status).toBe(400)
    expect(mocks.upsertCalendarConfig).not.toHaveBeenCalled()
  })

  it('rejects a negative defaultDurationMin', async () => {
    mocks.getCalendarConfig.mockResolvedValue(connectedConfig())
    const res = await PATCH(patchRequest({ defaultDurationMin: -5 }))
    expect(res.status).toBe(400)
    expect(mocks.upsertCalendarConfig).not.toHaveBeenCalled()
  })

  it('carries the existing refreshToken through untouched and never accepts one from the body', async () => {
    const existing = connectedConfig()
    mocks.getCalendarConfig.mockResolvedValue(existing)
    mocks.upsertCalendarConfig.mockResolvedValue({ ...existing, isActive: true })

    // Even if a caller tries to sneak a refreshToken in the body, it
    // must be ignored — the route type doesn't read it, but assert
    // the call to the repo used the pre-existing token.
    const res = await PATCH(
      patchRequest({ isActive: true, refreshToken: 'attacker-supplied-token' }),
    )
    expect(res.status).toBe(200)
    expect(mocks.upsertCalendarConfig).toHaveBeenCalledWith(
      context.supabase,
      'account-1',
      expect.objectContaining({ refreshToken: 'plaintext-rt-should-never-leak', isActive: true }),
    )
  })

  it('merges partial updates over the existing config', async () => {
    const existing = connectedConfig()
    mocks.getCalendarConfig.mockResolvedValue(existing)
    mocks.upsertCalendarConfig.mockResolvedValue({ ...existing, bufferMin: 30 })

    const res = await PATCH(patchRequest({ bufferMin: 30 }))
    expect(res.status).toBe(200)
    expect(mocks.upsertCalendarConfig).toHaveBeenCalledWith(
      context.supabase,
      'account-1',
      expect.objectContaining({
        bufferMin: 30,
        calendarId: existing.calendarId,
        timezone: existing.timezone,
        defaultDurationMin: existing.defaultDurationMin,
        minLeadTimeMin: existing.minLeadTimeMin,
        isActive: existing.isActive,
      }),
    )
  })
})
