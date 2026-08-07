import { describe, it, expect, vi } from 'vitest'
import {
  refreshAccessToken,
  getBusySlots,
  createEvent,
  updateEvent,
  deleteEvent,
  CalendarError,
  type HttpClient,
} from './client'

function ok(body: unknown, status = 200): Response {
  return { ok: true, status, json: async () => body } as unknown as Response
}
function err(status: number, body: unknown = { error: { message: 'nope' } }): Response {
  return { ok: false, status, json: async () => body } as unknown as Response
}

function mockHttp(...responses: Response[]): HttpClient {
  const fn = vi.fn()
  for (const r of responses) fn.mockResolvedValueOnce(r)
  return { fetch: fn as unknown as typeof fetch }
}

const creds = { clientId: 'cid', clientSecret: 'csecret' }

describe('refreshAccessToken', () => {
  it('exchanges a refresh token for an access token', async () => {
    const http = mockHttp(ok({ access_token: 'at-1', expires_in: 3600 }))
    const tokens = await refreshAccessToken('rt-1', creds, http)
    expect(tokens.accessToken).toBe('at-1')
    expect(tokens.rotatedRefreshToken).toBeNull()
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const [url, init] = vi.mocked(http.fetch).mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const body = new URLSearchParams(init!.body as string)
    expect(body.get('refresh_token')).toBe('rt-1')
    expect(body.get('grant_type')).toBe('refresh_token')
  })

  it('surfaces a rotated refresh token instead of dropping it', async () => {
    const http = mockHttp(ok({ access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-NEW' }))
    const tokens = await refreshAccessToken('rt-1', creds, http)
    expect(tokens.rotatedRefreshToken).toBe('rt-NEW')
  })

  it('throws CalendarError with code invalid_token on a 401', async () => {
    const http = mockHttp(err(401, { error: { message: 'invalid_grant' } }))
    await expect(refreshAccessToken('rt-1', creds, http)).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  it('throws when the response has no access_token', async () => {
    const http = mockHttp(ok({ expires_in: 3600 }))
    await expect(refreshAccessToken('rt-1', creds, http)).rejects.toThrow(CalendarError)
  })
})

describe('getBusySlots', () => {
  it('returns busy intervals for the requested calendar', async () => {
    const http = mockHttp(
      ok({
        calendars: {
          primary: {
            busy: [{ start: '2026-08-20T09:00:00Z', end: '2026-08-20T09:30:00Z' }],
          },
        },
      }),
    )
    const busy = await getBusySlots(
      'at-1',
      'primary',
      { start: new Date('2026-08-20T00:00:00Z'), end: new Date('2026-08-21T00:00:00Z') },
      http,
    )
    expect(busy).toHaveLength(1)
    expect(busy[0].start).toEqual(new Date('2026-08-20T09:00:00Z'))
  })

  it('returns [] when the calendar has no busy field', async () => {
    const http = mockHttp(ok({ calendars: { primary: {} } }))
    const busy = await getBusySlots(
      'at-1',
      'primary',
      { start: new Date(), end: new Date() },
      http,
    )
    expect(busy).toEqual([])
  })
})

describe('createEvent / updateEvent / deleteEvent', () => {
  const input = {
    summary: 'Demo EterShield',
    start: new Date('2026-08-20T09:00:00Z'),
    end: new Date('2026-08-20T09:30:00Z'),
    timezone: 'Europe/Lisbon',
  }

  it('createEvent posts with the account timezone and returns the created event', async () => {
    const http = mockHttp(
      ok({
        id: 'evt-1',
        htmlLink: 'https://calendar.google.com/evt-1',
        start: { dateTime: '2026-08-20T09:00:00Z' },
        end: { dateTime: '2026-08-20T09:30:00Z' },
      }),
    )
    const event = await createEvent('at-1', 'primary', input, http)
    expect(event.id).toBe('evt-1')

    const [url, init] = vi.mocked(http.fetch).mock.calls[0]
    expect(url).toContain('/calendars/primary/events')
    const body = JSON.parse(init!.body as string)
    expect(body.start.timeZone).toBe('Europe/Lisbon')
  })

  it('updateEvent PATCHes the given eventId', async () => {
    const http = mockHttp(
      ok({ id: 'evt-1', start: { dateTime: '2026-08-20T10:00:00Z' }, end: { dateTime: '2026-08-20T10:30:00Z' } }),
    )
    await updateEvent('at-1', 'primary', 'evt-1', input, http)
    const [url, init] = vi.mocked(http.fetch).mock.calls[0]
    expect(url).toContain('/events/evt-1')
    expect(init!.method).toBe('PATCH')
  })

  it('deleteEvent succeeds on a normal 200/204', async () => {
    const http = mockHttp({ ok: true, status: 204, json: async () => null } as unknown as Response)
    await expect(deleteEvent('at-1', 'primary', 'evt-1', http)).resolves.toBeUndefined()
  })

  it('deleteEvent treats a 404 (already gone) as success, not an error', async () => {
    const http = mockHttp(err(404))
    await expect(deleteEvent('at-1', 'primary', 'evt-1', http)).resolves.toBeUndefined()
  })

  it('deleteEvent still throws on a real failure (e.g. 403)', async () => {
    const http = mockHttp(err(403))
    await expect(deleteEvent('at-1', 'primary', 'evt-1', http)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})

describe('network failure', () => {
  it('wraps a fetch rejection in a CalendarError', async () => {
    const http: HttpClient = { fetch: vi.fn().mockRejectedValue(new Error('DNS fail')) as unknown as typeof fetch }
    await expect(refreshAccessToken('rt-1', creds, http)).rejects.toMatchObject({
      code: 'network_error',
    })
  })
})
