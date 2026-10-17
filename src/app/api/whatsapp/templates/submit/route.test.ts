import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const upserts: { row: Record<string, unknown>; options: unknown }[] = []

function makeSupabaseMock() {
  function builder(table: string) {
    const result = () => {
      switch (table) {
        case 'profiles':
          return { data: { account_id: 'acct-1', account_role: 'admin' }, error: null }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'message_templates':
          return { data: { id: 'tpl-1' }, error: null }
        default:
          return { data: null, error: null }
      }
    }
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq']) b[m] = vi.fn(chain)
    b.upsert = vi.fn((row: Record<string, unknown>, options: unknown) => {
      upserts.push({ row, options })
      return b
    })
    b.single = vi.fn(async () => result())
    b.maybeSingle = vi.fn(async () => result())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

beforeEach(() => {
  __resetRateLimitForTests()
  upserts.length = 0
  supabaseMock = makeSupabaseMock()
  vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', 'true')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/whatsapp/templates/submit', () => {
  it('upserts on the account-wide (account_id, name, language) key', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'order_update',
          category: 'Utility',
          language: 'en_US',
          body_text: 'Your order shipped.',
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(upserts).toHaveLength(1)
    expect(upserts[0].options).toEqual({ onConflict: 'account_id,name,language' })
    expect(upserts[0].row).toMatchObject({ account_id: 'acct-1', name: 'order_update' })
  })
})
