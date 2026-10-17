import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const templateUpdates: { patch: Record<string, unknown>; id: unknown }[] = []
const templateInserts: Record<string, unknown>[] = []
let localTemplates: { id: string }[] = []

function makeSupabaseMock() {
  function builder(table: string) {
    const filters: [string, unknown][] = []
    let pendingUpdate: Record<string, unknown> | null = null

    const result = () => {
      switch (table) {
        case 'profiles':
          return { data: { account_id: 'acct-1', account_role: 'admin' }, error: null }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'whatsapp_config':
          return {
            data: { id: 'cfg-1', account_id: 'acct-1', waba_id: 'WABA-1', access_token: 'enc' },
            error: null,
          }
        case 'message_templates':
          return { data: localTemplates, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'order', 'limit']) b[m] = vi.fn(chain)
    b.eq = vi.fn((column: string, value: unknown) => {
      filters.push([column, value])
      if (pendingUpdate && column === 'id') {
        templateUpdates.push({ patch: pendingUpdate, id: value })
      }
      return b
    })
    b.update = vi.fn((patch: Record<string, unknown>) => {
      pendingUpdate = patch
      return b
    })
    b.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === 'message_templates') templateInserts.push(row)
      return b
    })
    b.single = vi.fn(async () => result())
    b.maybeSingle = vi.fn(async () => {
      if (table === 'message_templates') {
        return localTemplates.length > 1
          ? { data: null, error: { message: 'multiple rows returned' } }
          : { data: localTemplates[0] ?? null, error: null }
      }
      return result()
    })
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(pendingUpdate || table !== 'message_templates' ? { data: null, error: null } : result())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'syncing-admin' } }, error: null })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc'),
  isLegacyFormat: vi.fn(() => false),
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const META_TEMPLATE = {
  id: 'meta-1',
  name: 'order_update',
  language: 'en_US',
  status: 'APPROVED',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Hello {{1}}' }],
}

beforeEach(() => {
  __resetRateLimitForTests()
  templateUpdates.length = 0
  templateInserts.length = 0
  localTemplates = []
  supabaseMock = makeSupabaseMock()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [META_TEMPLATE] }), { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/whatsapp/templates/sync', () => {
  it('updates an existing row without taking over its author', async () => {
    localTemplates = [{ id: 'local-1' }]

    const res = await POST()
    const body = await res.json()

    expect(body).toMatchObject({ success: true, updated: 1, inserted: 0 })
    expect(templateUpdates).toHaveLength(1)
    expect(templateUpdates[0].id).toBe('local-1')
    expect(templateUpdates[0].patch).not.toHaveProperty('user_id')
    expect(templateUpdates[0].patch).toMatchObject({
      account_id: 'acct-1',
      meta_template_id: 'meta-1',
      status: 'APPROVED',
    })
  })

  it('records the syncing admin as the author of a newly imported row', async () => {
    const res = await POST()
    const body = await res.json()

    expect(body).toMatchObject({ success: true, inserted: 1, updated: 0 })
    expect(templateInserts[0]).toMatchObject({
      account_id: 'acct-1',
      user_id: 'syncing-admin',
      name: 'order_update',
    })
  })

  it('still syncs when the account holds duplicate rows for the same name and language', async () => {
    localTemplates = [{ id: 'newest' }, { id: 'older' }]

    const res = await POST()
    const body = await res.json()

    expect(body).toMatchObject({ success: true, updated: 1, errors: [] })
    expect(templateUpdates[0].id).toBe('newest')
  })
})
