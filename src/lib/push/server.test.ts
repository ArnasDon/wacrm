import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendNotification = vi.fn()
const deleted: string[][] = []
let rows: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> = []

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: rows, error: null }), then: (r: (v: unknown) => void) => r({ data: rows, error: null }) }) }),
      delete: () => ({ in: async (_c: string, ids: string[]) => { deleted.push(ids); return {} } }),
    }),
  }),
}))

import { notifyInboundPush, sendPushToAccount } from './server'

beforeEach(() => {
  sendNotification.mockReset()
  deleted.length = 0
  rows = [
    { id: 'a', endpoint: 'https://push.example/a', p256dh: 'k', auth: 's' },
    { id: 'b', endpoint: 'https://push.example/b', p256dh: 'k', auth: 's' },
  ]
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
})

describe('sendPushToAccount', () => {
  it('does nothing and reports not-configured without VAPID keys', async () => {
    const r = await sendPushToAccount('acct', { v: 1 })
    expect(r).toMatchObject({ sent: 0, removed: 0, configured: false })
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('sends to every subscription and prunes expired ones (410)', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('/b')) throw Object.assign(new Error('gone'), { statusCode: 410 })
    })
    const r = await sendPushToAccount('acct', { v: 1, title: 't' })
    expect(r).toMatchObject({ sent: 1, removed: 1, configured: true, subscriptions: 2, errors: [] })
    expect(deleted).toEqual([['b']])
  })

  it('reports the push service refusal reason (e.g. key mismatch) instead of hiding it', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    sendNotification.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 403, body: 'invalid JWT provided' }))
    const r = await sendPushToAccount('acct', { v: 1 })
    expect(r.sent).toBe(0)
    expect(r.errors[0]).toContain('403')
    expect(r.errors[0]).toContain('invalid JWT')
  })

  it('notifyInboundPush never throws even if sending blows up', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    sendNotification.mockRejectedValue(new Error('boom'))
    await expect(
      notifyInboundPush({
        accountId: 'acct',
        payload: { v: 1, conversationId: 'c', title: 't', body: 'b', url: '/inbox', tag: 'c', ts: 1 },
      }),
    ).resolves.toBeUndefined()
  })
})
