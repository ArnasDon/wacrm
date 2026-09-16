import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  dispatchSystemAlert: vi.fn(),
  resolveSystemAlert: vi.fn(),
}))
vi.mock('@/lib/observability/alerts', () => ({
  dispatchSystemAlert: h.dispatchSystemAlert,
  resolveSystemAlert: h.resolveSystemAlert,
}))

import { POST } from './route'

function req(body: unknown, secret: string | null = 'shh') {
  return {
    headers: { get: (name: string) => (name === 'x-watcher-secret' ? secret : null) },
    json: async () => body,
  } as unknown as Request
}

beforeEach(() => {
  vi.stubEnv('ALERT_WATCHER_NOTIFY_SECRET', 'shh')
  h.dispatchSystemAlert.mockReset().mockResolvedValue({ opened: true, notified: true, alertId: 'a1' })
  h.resolveSystemAlert.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/system/alert-watcher/log-alert', () => {
  it('rejects a missing secret', async () => {
    const res = await POST(req({}, null))
    expect(res.status).toBe(401)
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret — never reaches dispatchSystemAlert', async () => {
    const res = await POST(req({ severity: 'warning', source: 'x', title: 'x', dedupKey: 'k' }, 'wrong'))
    expect(res.status).toBe(401)
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('503s when the secret is not configured at all — fails closed, not open', async () => {
    vi.stubEnv('ALERT_WATCHER_NOTIFY_SECRET', '')
    const res = await POST(req({ severity: 'warning', source: 'x', title: 'x', dedupKey: 'k' }))
    expect(res.status).toBe(503)
  })

  it('rejects a body missing dedupKey', async () => {
    const res = await POST(req({ severity: 'warning', source: 'x', title: 'x' }))
    expect(res.status).toBe(400)
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('rejects an invalid severity — never forwards an unvalidated value', async () => {
    const res = await POST(req({ severity: 'apocalyptic', source: 'x', title: 'x', dedupKey: 'k' }))
    expect(res.status).toBe(400)
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('dispatches a well-formed alert through the same internal function every other alert source uses', async () => {
    const res = await POST(
      req({
        severity: 'critical',
        source: 'external_uptime_check',
        title: 'chatsandia.com unreachable',
        detail: { checked_at: '2026-09-16T00:00:00Z' },
        dedupKey: 'external-outage-2026-09-16-05',
        accountId: null,
        throttleMinutes: 60,
      }),
    )
    expect(res.status).toBe(200)
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith({
      severity: 'critical',
      source: 'external_uptime_check',
      title: 'chatsandia.com unreachable',
      detail: { checked_at: '2026-09-16T00:00:00Z' },
      dedupKey: 'external-outage-2026-09-16-05',
      accountId: null,
      throttleMinutes: 60,
    })
    expect(await res.json()).toEqual({ opened: true, notified: true, alertId: 'a1' })
  })

  it('action: "resolve" calls resolveSystemAlert instead, and never dispatchSystemAlert', async () => {
    const res = await POST(req({ action: 'resolve', dedupKey: 'external-outage-2026-09-16-05' }))
    expect(res.status).toBe(200)
    expect(h.resolveSystemAlert).toHaveBeenCalledWith('external-outage-2026-09-16-05')
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })
})
