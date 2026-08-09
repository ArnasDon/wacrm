import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  loadAiConfig: vi.fn(),
  summarizeAndStoreMemory: vi.fn(),
}))

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: mocks.loadAiConfig }))
vi.mock('@/lib/ai/contact-memory', () => ({
  summarizeAndStoreMemory: mocks.summarizeAndStoreMemory,
}))

import { GET } from './route'

const originalSecret = process.env.AUTOMATION_CRON_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTOMATION_CRON_SECRET = 'cron-secret'
  mocks.supabaseAdmin.mockReturnValue({
    from: (table: string) => {
      if (table === 'contact_memories') {
        const chain = {
          delete: () => chain,
          lt: () => Promise.resolve({ count: 2, error: null }),
        }
        return chain
      }
      const chain = {
        select: () => chain,
        not: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }),
      }
      return chain
    },
  })
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTOMATION_CRON_SECRET
  else process.env.AUTOMATION_CRON_SECRET = originalSecret
})

describe('AI contact-memory cron', () => {
  it('rejects an invalid shared secret', async () => {
    const response = await GET(
      new Request('https://crm.test/api/ai/memory/cron', {
        headers: { 'x-cron-secret': 'wrong' },
      }),
    )
    expect(response.status).toBe(401)
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
  })

  it('prunes expired memory and returns when nothing is due', async () => {
    const response = await GET(
      new Request('https://crm.test/api/ai/memory/cron', {
        headers: { 'x-cron-secret': 'cron-secret' },
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      processed: 0,
      skipped: 0,
      failed: 0,
      pruned: 2,
    })
  })
})
