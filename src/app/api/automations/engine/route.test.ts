import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(async () => undefined),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acc-1', userId: 'user-1', role: 'agent' }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 403,
  }),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function trigger() {
  return POST(
    new Request('http://t/api/automations/engine', {
      method: 'POST',
      body: JSON.stringify({ trigger_type: 'new_contact', contact_id: 'c-1' }),
    }),
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>
}

beforeEach(() => {
  __resetRateLimitForTests()
})

describe('POST /api/automations/engine rate limit', () => {
  it('stops dispatching automations once the per-user budget is spent', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await trigger()).status).toBe(200)
    }
    expect(h.runAutomationsForTrigger).toHaveBeenCalledTimes(30)

    const limited = await trigger()
    expect(limited.status).toBe(429)
    expect(h.runAutomationsForTrigger).toHaveBeenCalledTimes(30)
  })
})
