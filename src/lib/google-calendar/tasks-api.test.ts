import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  createGoogleTask,
  updateGoogleTask,
  deleteGoogleTask,
  hasGoogleCalendarConnected,
  DEFAULT_TASK_LIST_ID,
} from './tasks-api'
import { GoogleCalendarError } from './oauth'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response
}

function errResponse(status: number, body = 'nope'): Response {
  return { ok: false, status, json: async () => ({}), text: async () => body } as unknown as Response
}

/** A `google_calendar_config` row valid enough that `getValidAccessToken`
 *  returns its cached access token without hitting `fetch` itself —
 *  keeps these tests focused on the Tasks API calls, not the token
 *  refresh path (already covered by oauth.test.ts). */
function makeDb(row: { status: string } | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: row && {
          ...row,
          refresh_token: encrypt('refresh-1'),
          access_token: encrypt('access-1'),
          token_expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        error: null,
      }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('hasGoogleCalendarConnected', () => {
  it('is true only when status is exactly "connected"', async () => {
    expect(await hasGoogleCalendarConnected(makeDb({ status: 'connected' }), 'acct-1')).toBe(true)
    expect(await hasGoogleCalendarConnected(makeDb({ status: 'disconnected' }), 'acct-1')).toBe(false)
    expect(await hasGoogleCalendarConnected(makeDb(null), 'acct-1')).toBe(false)
  })
})

describe('createGoogleTask', () => {
  it('returns null without calling the API when the account has no Google Calendar connection', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const ref = await createGoogleTask(makeDb(null), 'acct-1', { title: 'Llamar a Jefferson' })

    expect(ref).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates the task against the default list and returns its id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: 'gtask-1' }))
    vi.stubGlobal('fetch', fetchMock)

    const ref = await createGoogleTask(makeDb({ status: 'connected' }), 'acct-1', {
      title: 'Llamar a Jefferson',
      notes: 'Confirmar pedido',
      dueISO: '2026-09-05T21:01:00.000Z',
    })

    expect(ref).toEqual({ googleTaskId: 'gtask-1', googleTaskListId: DEFAULT_TASK_LIST_ID })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain(`/lists/${DEFAULT_TASK_LIST_ID}/tasks`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      title: 'Llamar a Jefferson',
      notes: 'Confirmar pedido',
      due: '2026-09-05T21:01:00.000Z',
    })
  })

  it('throws GoogleCalendarError on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(403, 'insufficient scope')))

    await expect(
      createGoogleTask(makeDb({ status: 'connected' }), 'acct-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(GoogleCalendarError)
  })
})

describe('updateGoogleTask', () => {
  const ref = { googleTaskId: 'gtask-1', googleTaskListId: DEFAULT_TASK_LIST_ID }

  it('maps done:true to status "completed" and skips an empty patch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await updateGoogleTask(makeDb({ status: 'connected' }), 'acct-1', ref, { done: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain(`/lists/${encodeURIComponent(DEFAULT_TASK_LIST_ID)}/tasks/gtask-1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ status: 'completed' })
  })

  it('does nothing when nothing in the patch is provided', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await updateGoogleTask(makeDb({ status: 'connected' }), 'acct-1', ref, {})

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when the account is no longer connected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await updateGoogleTask(makeDb(null), 'acct-1', ref, { title: 'new title' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('deleteGoogleTask', () => {
  const ref = { googleTaskId: 'gtask-1', googleTaskListId: DEFAULT_TASK_LIST_ID }

  it('treats a 404 as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(404)))
    await expect(
      deleteGoogleTask(makeDb({ status: 'connected' }), 'acct-1', ref),
    ).resolves.toBeUndefined()
  })

  it('throws on a genuine failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(500)))
    await expect(
      deleteGoogleTask(makeDb({ status: 'connected' }), 'acct-1', ref),
    ).rejects.toBeInstanceOf(GoogleCalendarError)
  })
})
