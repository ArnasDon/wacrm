import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getBusinessProfile,
  upsertBusinessProfile,
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  loadBusinessProfileForAgent,
} from './service'

// ------------------------------------------------------------
// Same generic in-memory fake as data-sources/service.test.ts — a
// Map<string, row[]> per table, filtered by chained .eq() calls,
// supporting select/insert/update/delete + single/maybeSingle/then.
// Reused verbatim rather than reinvented, per this project's own
// established test-double convention.
// ------------------------------------------------------------
function fakeDb() {
  const tables = new Map<string, Record<string, unknown>[]>()
  let nextId = 1
  const table = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!

  function builder(tableName: string, op: 'select' | 'update' | 'insert' | 'delete', payload?: Record<string, unknown>) {
    const filters: [string, unknown][] = []
    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push([col, val])
        return api
      },
      order: () => api,
      limit: () => api,
      single: () => run(true),
      maybeSingle: () => run(true),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => run(false).then(resolve, reject),
    }
    const rows = table(tableName)
    const matches = (row: Record<string, unknown>) => filters.every(([col, val]) => row[col] === val)

    async function run(singleResult: boolean) {
      if (op === 'select') {
        const matched = rows.filter(matches)
        return singleResult ? { data: matched[0] ?? null, error: null } : { data: matched, error: null }
      }
      if (op === 'update') {
        const matched = rows.filter(matches)
        for (const row of matched) Object.assign(row, payload)
        return singleResult ? { data: matched[0] ?? null, error: null } : { data: matched, error: null }
      }
      if (op === 'insert') {
        const items = Array.isArray(payload) ? payload : [payload as Record<string, unknown>]
        const inserted = items.map((p) => ({ id: `${tableName}-${nextId++}`, ...p }))
        rows.push(...inserted)
        return singleResult ? { data: inserted[0] ?? null, error: null } : { data: inserted, error: null }
      }
      if (op === 'delete') {
        const remaining = rows.filter((r) => !matches(r))
        table(tableName).length = 0
        table(tableName).push(...remaining)
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }
    return api
  }

  return {
    db: {
      from: (name: string) => ({
        select: () => builder(name, 'select'),
        update: (payload: Record<string, unknown>) => builder(name, 'update', payload),
        insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => builder(name, 'insert', payload as never),
        delete: () => builder(name, 'delete'),
      }),
    } as unknown as SupabaseClient,
    table,
  }
}

// ============================================================
// Business Profile service — AI optimization project, FASE 6. Covers
// CRUD correctness and, critically, the account-isolation guarantee
// (Parte 3 of the audit's Security section): every read/write is scoped
// by an explicit account_id argument the caller controls, never
// something derived from the row itself.
// ============================================================

describe('getBusinessProfile / upsertBusinessProfile', () => {
  it('returns null (not an error) for an unconfigured account', async () => {
    const { db } = fakeDb()
    expect(await getBusinessProfile(db, 'acct-1')).toBeNull()
  })

  it('creates on first upsert, then updates in place on a second call', async () => {
    const { db } = fakeDb()
    const created = await upsertBusinessProfile(db, 'acct-1', 'user-1', { businessName: 'Ferretería El Tornillo' })
    expect(created.businessName).toBe('Ferretería El Tornillo')
    expect(created.accountId).toBe('acct-1')

    const updated = await upsertBusinessProfile(db, 'acct-1', 'user-1', { phone: '555-1111' })
    expect(updated.phone).toBe('555-1111')
    // Partial update — the field from the first call must survive.
    expect(updated.businessName).toBe('Ferretería El Tornillo')

    const all = (await getBusinessProfile(db, 'acct-1'))!
    expect(all).toMatchObject({ businessName: 'Ferretería El Tornillo', phone: '555-1111' })
  })

  it('account isolation: acct-2 never sees acct-1\'s profile', async () => {
    const { db } = fakeDb()
    await upsertBusinessProfile(db, 'acct-1', 'user-1', { businessName: 'Negocio Uno' })
    expect(await getBusinessProfile(db, 'acct-2')).toBeNull()
  })
})

describe('departments CRUD', () => {
  it('creates, lists, updates, and deletes a department', async () => {
    const { db } = fakeDb()
    const created = await createDepartment(db, 'acct-1', { name: 'Ventas' })
    expect(created.name).toBe('Ventas')
    expect(created.active).toBe(true)

    const listed = await listDepartments(db, 'acct-1')
    expect(listed).toHaveLength(1)

    const updated = await updateDepartment(db, 'acct-1', created.id, { active: false })
    expect(updated.active).toBe(false)

    await deleteDepartment(db, 'acct-1', created.id)
    expect(await listDepartments(db, 'acct-1')).toHaveLength(0)
  })

  it('account isolation: acct-2 cannot list, update, or delete acct-1\'s department', async () => {
    const { db } = fakeDb()
    const dept = await createDepartment(db, 'acct-1', { name: 'Ventas' })

    expect(await listDepartments(db, 'acct-2')).toHaveLength(0)
    await expect(updateDepartment(db, 'acct-2', dept.id, { name: 'Hackeado' })).rejects.toBeTruthy()
    await deleteDepartment(db, 'acct-2', dept.id) // no-op, matches nothing
    expect(await listDepartments(db, 'acct-1')).toHaveLength(1)
  })
})

describe('contacts CRUD', () => {
  it('creates, lists, updates, and deletes a contact', async () => {
    const { db } = fakeDb()
    const dept = await createDepartment(db, 'acct-1', { name: 'Ventas' })
    const created = await createContact(db, 'acct-1', { name: 'Carlos Pérez', departmentId: dept.id, phone: '555-1111' })
    expect(created.departmentId).toBe(dept.id)

    const listed = await listContacts(db, 'acct-1')
    expect(listed).toHaveLength(1)

    const updated = await updateContact(db, 'acct-1', created.id, { active: false })
    expect(updated.active).toBe(false)

    await deleteContact(db, 'acct-1', created.id)
    expect(await listContacts(db, 'acct-1')).toHaveLength(0)
  })

  it('account isolation: acct-2 cannot list, update, or delete acct-1\'s contact', async () => {
    const { db } = fakeDb()
    const contact = await createContact(db, 'acct-1', { name: 'Carlos Pérez' })

    expect(await listContacts(db, 'acct-2')).toHaveLength(0)
    await expect(updateContact(db, 'acct-2', contact.id, { name: 'Hackeado' })).rejects.toBeTruthy()
    await deleteContact(db, 'acct-2', contact.id) // no-op, matches nothing
    expect(await listContacts(db, 'acct-1')).toHaveLength(1)
  })
})

describe('loadBusinessProfileForAgent', () => {
  it('bundles profile + active departments + active contacts, filtering out inactive ones', async () => {
    const { db } = fakeDb()
    await upsertBusinessProfile(db, 'acct-1', 'user-1', { businessName: 'Mi Negocio' })
    const active = await createDepartment(db, 'acct-1', { name: 'Ventas' })
    await createDepartment(db, 'acct-1', { name: 'Archivado', active: false })
    await createContact(db, 'acct-1', { name: 'Carlos Pérez', departmentId: active.id })
    await createContact(db, 'acct-1', { name: 'Inactivo', active: false })

    const result = await loadBusinessProfileForAgent(db, 'acct-1')
    expect(result.profile?.businessName).toBe('Mi Negocio')
    expect(result.departments).toHaveLength(1)
    expect(result.departments[0].name).toBe('Ventas')
    expect(result.contacts).toHaveLength(1)
    expect(result.contacts[0].name).toBe('Carlos Pérez')
  })

  it('account isolation: acct-2 gets an entirely empty result while acct-1 has data configured', async () => {
    const { db } = fakeDb()
    await upsertBusinessProfile(db, 'acct-1', 'user-1', { businessName: 'Mi Negocio' })
    await createDepartment(db, 'acct-1', { name: 'Ventas' })
    await createContact(db, 'acct-1', { name: 'Carlos Pérez' })

    const result = await loadBusinessProfileForAgent(db, 'acct-2')
    expect(result).toEqual({ profile: null, departments: [], contacts: [] })
  })

  it('tolerates a fully unconfigured account (Parte 16 — no Business Profile, no departments, no contacts)', async () => {
    const { db } = fakeDb()
    const result = await loadBusinessProfileForAgent(db, 'acct-1')
    expect(result).toEqual({ profile: null, departments: [], contacts: [] })
  })
})
