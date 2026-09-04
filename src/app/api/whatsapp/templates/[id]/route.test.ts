import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// BUG A1 fix (WhatsApp audit) — PATCH/DELETE /api/whatsapp/templates/[id]
// used to resolve `account_id` straight off the caller's profile (any
// role) and call Meta's real `editMessageTemplate` / `deleteMessageTemplate`
// BEFORE the RLS-gated local write. A viewer or agent could therefore
// force a real, irreversible edit or delete on Meta — flipping an
// APPROVED template back to PENDING, or destroying it outright — even
// though the local `message_templates` update/delete (admin-only per
// migration 017) was always going to be refused.
//
// These tests prove the property the fix establishes:
//   viewer/agent -> requireRole('admin') -> 403 -> END
// and NEVER:
//   viewer/agent -> Meta call -> RLS rejects DB write -> 500
// ============================================================

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'

let callerRole = 'admin'
let callerAccountId = 'acct-1'
/** account_id the existing template row actually belongs to. */
let templateAccountId = 'acct-1'
let templateRow: Record<string, unknown> | null = null
let configRow: Record<string, unknown> | null = null

/** Every `message_templates` UPDATE payload actually applied, in order. */
const updates: Array<Record<string, unknown>> = []
/** Every `message_templates` id actually DELETEd, in order. */
const deletes: string[] = []

function makeSupabaseMock() {
  function builder(table: string) {
    let op: 'select' | 'update' | 'delete' = 'select'
    let payload: Record<string, unknown> | undefined
    const filters: Record<string, unknown> = {}

    const result = (): { data: unknown; error: unknown } => {
      if (table === 'profiles') {
        return {
          data: { account_id: callerAccountId, account_role: callerRole },
          error: null,
        }
      }
      if (table === 'accounts') {
        return { data: { id: callerAccountId, name: 'Acme' }, error: null }
      }
      if (table === 'message_templates') {
        if (op === 'update') {
          updates.push({ ...filters, ...payload })
          return { data: { id: TEMPLATE_ID, ...payload }, error: null }
        }
        if (op === 'delete') {
          deletes.push(String(filters.id ?? ''))
          return { data: null, error: null }
        }
        // select (the ownership-scoped lookup at the top of each handler)
        if (!templateRow) return { data: null, error: null }
        if ('account_id' in filters && filters.account_id !== templateAccountId) {
          return { data: null, error: null }
        }
        if ('id' in filters && filters.id !== templateRow.id) {
          return { data: null, error: null }
        }
        return { data: templateRow, error: null }
      }
      if (table === 'whatsapp_config') {
        return configRow
          ? { data: configRow, error: null }
          : { data: null, error: { message: 'not found' } }
      }
      return { data: null, error: null }
    }

    const b: Record<string, unknown> = {}
    b.select = vi.fn(() => b)
    b.eq = vi.fn((col: string, val: unknown) => {
      filters[col] = val
      return b
    })
    b.update = vi.fn((p: Record<string, unknown>) => {
      op = 'update'
      payload = p
      return b
    })
    b.delete = vi.fn(() => {
      op = 'delete'
      return b
    })
    b.single = vi.fn(() => Promise.resolve(result()))
    b.maybeSingle = vi.fn(() => Promise.resolve(result()))
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
}))

const { editMessageTemplate, deleteMessageTemplate } = vi.hoisted(() => ({
  editMessageTemplate: vi.fn(async () => ({ success: true })),
  deleteMessageTemplate: vi.fn(async () => undefined),
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  editMessageTemplate,
  deleteMessageTemplate,
}))

import { PATCH, DELETE } from './route'

function patchTemplate(overrides: Record<string, unknown> = {}) {
  return PATCH(
    new Request(`http://localhost/api/whatsapp/templates/${TEMPLATE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'order_update',
        category: 'Marketing',
        language: 'en_US',
        body_text: 'Hello there, thanks for shopping with us.',
        ...overrides,
      }),
    }),
    { params: Promise.resolve({ id: TEMPLATE_ID }) },
  )
}

function deleteTemplate() {
  return DELETE(
    new Request(`http://localhost/api/whatsapp/templates/${TEMPLATE_ID}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: TEMPLATE_ID }) },
  )
}

describe('PATCH/DELETE /api/whatsapp/templates/[id] — role enforcement (BUG A1)', () => {
  beforeEach(() => {
    callerRole = 'admin'
    callerAccountId = 'acct-1'
    templateAccountId = 'acct-1'
    templateRow = {
      id: TEMPLATE_ID,
      name: 'order_update',
      status: 'APPROVED',
      meta_template_id: 'meta-tpl-1',
      language: 'en_US',
    }
    configRow = {
      id: 'cfg-1',
      account_id: 'acct-1',
      waba_id: 'waba-1',
      access_token: 'enc-token',
    }
    updates.length = 0
    deletes.length = 0
    supabaseMock = makeSupabaseMock()
    editMessageTemplate.mockClear()
    deleteMessageTemplate.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('1. viewer + PATCH -> 403, Meta not called, DB untouched', async () => {
    callerRole = 'viewer'
    const res = await patchTemplate()
    expect(res.status).toBe(403)
    expect(editMessageTemplate).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('2. agent + PATCH -> 403, Meta not called, DB untouched', async () => {
    callerRole = 'agent'
    const res = await patchTemplate()
    expect(res.status).toBe(403)
    expect(editMessageTemplate).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('3. admin + PATCH -> preserved behavior: edits on Meta, updates locally', async () => {
    callerRole = 'admin'
    const res = await patchTemplate()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(editMessageTemplate).toHaveBeenCalledTimes(1)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ status: 'PENDING' })
  })

  it('4. viewer + DELETE -> 403, Meta not called, DB untouched', async () => {
    callerRole = 'viewer'
    const res = await deleteTemplate()
    expect(res.status).toBe(403)
    expect(deleteMessageTemplate).not.toHaveBeenCalled()
    expect(deletes).toHaveLength(0)
  })

  it('5. agent + DELETE -> 403, Meta not called, DB untouched', async () => {
    callerRole = 'agent'
    const res = await deleteTemplate()
    expect(res.status).toBe(403)
    expect(deleteMessageTemplate).not.toHaveBeenCalled()
    expect(deletes).toHaveLength(0)
  })

  it('6. admin + DELETE -> preserved behavior: deletes on Meta and locally', async () => {
    callerRole = 'admin'
    const res = await deleteTemplate()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(deleteMessageTemplate).toHaveBeenCalledTimes(1)
    expect(deletes).toEqual([TEMPLATE_ID])
  })

  it('7. admin of a different account has no access to this template (404), Meta not called', async () => {
    callerRole = 'admin'
    callerAccountId = 'acct-2' // the template actually belongs to acct-1
    const patchRes = await patchTemplate()
    expect(patchRes.status).toBe(404)
    expect(editMessageTemplate).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)

    const delRes = await deleteTemplate()
    expect(delRes.status).toBe(404)
    expect(deleteMessageTemplate).not.toHaveBeenCalled()
    expect(deletes).toHaveLength(0)
  })

  it('8. an APPROVED template cannot be edited or deleted by viewer/agent', async () => {
    templateRow!.status = 'APPROVED'
    for (const role of ['viewer', 'agent']) {
      callerRole = role
      const patchRes = await patchTemplate()
      expect(patchRes.status).toBe(403)
      const delRes = await deleteTemplate()
      expect(delRes.status).toBe(403)
    }
    expect(editMessageTemplate).not.toHaveBeenCalled()
    expect(deleteMessageTemplate).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
    expect(deletes).toHaveLength(0)
  })
})
