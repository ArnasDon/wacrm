import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Regression coverage for GHSA-m4fx-g6pr-hrw8 (WACRM-002 / WACRM-003), the
// last surface named by GHSA-hxp9-37p2-rvxv.
//
// Both handlers reach Meta before they write anything locally, so the
// admin-only message_templates_update / _delete RLS policies were never the
// gate they looked like: a viewer or agent got the remote edit or delete
// through and only the local mirror bounced. Nothing un-edits a template on
// Meta, so the role has to be checked before the outbound call.
//
// `requireRole` is the real implementation here — only the profile row it
// reads is mocked — so these tests exercise the actual role comparison.
// ---------------------------------------------------------------------------

/** Role `requireRole` reads off the caller's profile row. */
let callerRole = 'admin'

const TEMPLATE = {
  id: '3f1c9d2e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
  name: 'order_update',
  status: 'APPROVED',
  meta_template_id: 'meta-1',
  language: 'en_US',
}

/** Local writes the route managed to land. */
const templateUpdates: Record<string, unknown>[] = []
let templateDeletes = 0

function makeSupabaseMock() {
  function builder(table: string) {
    const result = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'message_templates':
          return { data: TEMPLATE, error: null }
        case 'whatsapp_config':
          return {
            data: {
              id: 'cfg-1',
              account_id: 'acct-1',
              phone_number_id: 'PNID-1',
              waba_id: 'WABA-1',
              access_token: 'enc-token',
            },
            error: null,
          }
        default:
          return { data: null, error: null }
      }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = vi.fn(chain)
    b.update = vi.fn((patch: Record<string, unknown>) => {
      if (table === 'message_templates') templateUpdates.push(patch)
      return b
    })
    b.delete = vi.fn(() => {
      if (table === 'message_templates') templateDeletes += 1
      return b
    })
    b.single = vi.fn(async () => result())
    b.maybeSingle = vi.fn(async () => result())
    b.then = (resolve: (v: unknown) => unknown) => resolve(result())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
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
  encrypt: vi.fn(() => 'enc-token'),
  isLegacyFormat: vi.fn(() => false),
}))

const meta = vi.hoisted(() => ({
  editMessageTemplate: vi.fn(async () => ({})),
  deleteMessageTemplate: vi.fn(async () => ({})),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

vi.mock('@/lib/whatsapp/template-header-handle', () => ({
  ensureMediaHeaderHandle: vi.fn(async () => undefined),
}))

import { PATCH, DELETE } from './route'

const params = Promise.resolve({ id: TEMPLATE.id })

function patchTemplate() {
  return PATCH(
    new Request('http://localhost/api/whatsapp/templates/' + TEMPLATE.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'order_update',
        category: 'Marketing',
        language: 'en_US',
        body_text: 'Rewritten by an unprivileged member',
      }),
    }),
    { params },
  )
}

beforeEach(() => {
  templateUpdates.length = 0
  templateDeletes = 0
  callerRole = 'admin'
  supabaseMock = makeSupabaseMock()
  meta.editMessageTemplate.mockClear()
  meta.deleteMessageTemplate.mockClear()
})

describe('template lifecycle role gate (GHSA-m4fx-g6pr-hrw8)', () => {
  for (const role of ['viewer', 'agent']) {
    it(`refuses PATCH for a ${role} before calling Meta`, async () => {
      callerRole = role
      const res = await patchTemplate()
      expect(res.status).toBe(403)
      expect(meta.editMessageTemplate).not.toHaveBeenCalled()
      expect(templateUpdates).toHaveLength(0)
    })

    it(`refuses DELETE for a ${role} before calling Meta`, async () => {
      callerRole = role
      const res = await DELETE(new Request('http://localhost/t'), { params })
      expect(res.status).toBe(403)
      expect(meta.deleteMessageTemplate).not.toHaveBeenCalled()
      expect(templateDeletes).toBe(0)
    })
  }

  it('still lets an admin edit and delete', async () => {
    const patched = await patchTemplate()
    expect(patched.status).toBe(200)
    expect(meta.editMessageTemplate).toHaveBeenCalledTimes(1)

    const deleted = await DELETE(new Request('http://localhost/t'), { params })
    expect(deleted.status).toBe(200)
    expect(meta.deleteMessageTemplate).toHaveBeenCalledTimes(1)
  })
})
