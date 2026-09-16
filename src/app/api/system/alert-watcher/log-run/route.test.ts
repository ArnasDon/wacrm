import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  state: {
    /** `system_alerts` row the mocked FK-existence check returns, or null. */
    alertRow: { id: 'alert-1' } as { id: string } | null,
    /** Rows inserted via `db.from('system_alert_watcher_runs').insert(...)`. */
    inserts: [] as Record<string, unknown>[],
    insertError: null as { message: string } | null,
  },
}))

vi.mock('@/lib/platform/admin-client', () => ({
  platformAdminClient: () => ({
    from: (table: string) => {
      if (table === 'system_alerts') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.alertRow, error: null }),
        }
        return chain
      }
      if (table === 'system_alert_watcher_runs') {
        return {
          insert: (payload: Record<string, unknown>) => {
            h.state.inserts.push(payload)
            return {
              select: () => ({
                single: () =>
                  h.state.insertError
                    ? Promise.resolve({ data: null, error: h.state.insertError })
                    : Promise.resolve({ data: { id: 'run-1' }, error: null }),
              }),
            }
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
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
  h.state.alertRow = { id: 'alert-1' }
  h.state.inserts = []
  h.state.insertError = null
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/system/alert-watcher/log-run', () => {
  it('rejects a wrong secret before touching the database', async () => {
    const res = await POST(req({ alertId: 'alert-1', status: 'diagnosed_only', summary: 'x' }, 'wrong'))
    expect(res.status).toBe(401)
    expect(h.state.inserts).toEqual([])
  })

  it('rejects a body missing required fields', async () => {
    const res = await POST(req({ alertId: 'alert-1' }))
    expect(res.status).toBe(400)
    expect(h.state.inserts).toEqual([])
  })

  it('rejects a status outside pr_opened/diagnosed_only', async () => {
    const res = await POST(req({ alertId: 'alert-1', status: 'made_it_up', summary: 'x' }))
    expect(res.status).toBe(400)
    expect(h.state.inserts).toEqual([])
  })

  it('404s when alertId does not reference a real system_alerts row — cannot be used to probe other tables', async () => {
    h.state.alertRow = null
    const res = await POST(req({ alertId: 'nope', status: 'diagnosed_only', summary: 'x' }))
    expect(res.status).toBe(404)
    expect(h.state.inserts).toEqual([])
  })

  it('logs a well-formed run', async () => {
    const res = await POST(
      req({
        alertId: 'alert-1',
        status: 'pr_opened',
        summary: 'Fixed the thing.',
        branch: 'fix/thing',
        prUrl: 'https://github.com/x/y/pull/1',
        testsPassed: true,
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'run-1' })
    expect(h.state.inserts).toEqual([
      {
        alert_id: 'alert-1',
        status: 'pr_opened',
        summary: 'Fixed the thing.',
        branch: 'fix/thing',
        pr_url: 'https://github.com/x/y/pull/1',
        tests_passed: true,
      },
    ])
  })

  it('surfaces an insert failure as a 500, not a silent success', async () => {
    h.state.insertError = { message: 'constraint violation' }
    const res = await POST(req({ alertId: 'alert-1', status: 'diagnosed_only', summary: 'x' }))
    expect(res.status).toBe(500)
  })
})
