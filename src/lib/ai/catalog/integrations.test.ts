import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Identity crypto in tests — same convention as config.test.ts — so
// assertions can check "the stored value differs from the plaintext"
// without depending on real AES ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

import { saveCatalogIntegration, loadActiveCatalogIntegrations, listCatalogIntegrations } from './integrations'

/**
 * Minimal in-memory fake covering exactly the query shapes
 * catalog/integrations.ts issues against `catalog_integrations`:
 * select+eq*+order*, update+eq*(+select+single), insert(+select+single),
 * delete+eq*. Good enough to test the service's own logic without a
 * real Postgres/RLS round trip (RLS itself is exercised by the SQL in
 * migration 044, which this file does not re-test).
 */
function fakeDb(initialRows: Record<string, unknown>[] = []) {
  let rows = initialRows.map((r) => ({ ...r }))
  let nextId = 1

  function builder(op: 'select' | 'update' | 'insert' | 'delete', payload?: Record<string, unknown>) {
    const filters: [string, unknown][] = []
    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push([col, val])
        return api
      },
      order: () => api,
      single: () => run(true),
      maybeSingle: () => run(true),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        run(false).then(resolve, reject),
    }

    function matches(row: Record<string, unknown>) {
      return filters.every(([col, val]) => row[col] === val)
    }

    async function run(singleResult: boolean) {
      if (op === 'select') {
        const matched = rows.filter(matches)
        return singleResult ? { data: matched[0] ?? null, error: null } : { data: matched, error: null }
      }
      if (op === 'update') {
        const matched = rows.filter(matches)
        for (const row of matched) Object.assign(row, payload)
        return singleResult
          ? { data: matched[0] ?? null, error: null }
          : { data: matched, error: null }
      }
      if (op === 'insert') {
        const row = { id: `int-${nextId++}`, ...payload }
        rows.push(row)
        return singleResult ? { data: row, error: null } : { data: [row], error: null }
      }
      if (op === 'delete') {
        const before = rows.length
        rows = rows.filter((r) => !matches(r))
        return { data: null, error: null, count: before - rows.length }
      }
      return { data: null, error: null }
    }

    return api
  }

  return {
    db: {
      from: () => ({
        select: () => builder('select'),
        update: (payload: Record<string, unknown>) => builder('update', payload),
        insert: (payload: Record<string, unknown>) => builder('insert', payload),
        delete: () => builder('delete'),
      }),
    } as unknown as SupabaseClient,
    rows: () => rows,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('saveCatalogIntegration — encryption', () => {
  it('never stores the plaintext secret — encrypted_secret differs from the input', async () => {
    const { db, rows } = fakeDb()
    await saveCatalogIntegration(db, 'acct-1', 'user-1', {
      provider: 'budun',
      displayName: 'Budun ERP',
      baseUrl: 'https://erp.example.com',
      secret: 'plaintext-secret-value',
    })
    expect(rows()[0].encrypted_secret).toBe('enc:plaintext-secret-value')
    expect(rows()[0].encrypted_secret).not.toBe('plaintext-secret-value')
  })

  it('loadActiveCatalogIntegrations decrypts the secret for internal use only', async () => {
    const { db } = fakeDb([
      {
        id: 'int-1',
        account_id: 'acct-1',
        provider: 'budun',
        display_name: 'Budun ERP',
        base_url: 'https://erp.example.com',
        app_key: null,
        scopes: ['catalog:read'],
        status: 'active',
        priority: 100,
        is_primary: true,
        last_test_at: null,
        last_test_ok: null,
        last_error: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        encrypted_secret: 'enc:my-secret',
      },
    ])
    const active = await loadActiveCatalogIntegrations(db, 'acct-1')
    expect(active).toHaveLength(1)
    expect(active[0].secret).toBe('my-secret')
    // The public row shape returned alongside it must NOT carry the
    // ciphertext (routes select PUBLIC_COLUMNS for anything client-facing).
    expect(active[0].row).not.toHaveProperty('encrypted_secret')
  })
})

describe('saveCatalogIntegration — partial update does not clobber untouched fields', () => {
  const EXISTING = {
    id: 'int-1',
    account_id: 'acct-1',
    provider: 'budun',
    display_name: 'Budun ERP',
    base_url: 'https://erp.example.com',
    app_key: 'app-key-123',
    scopes: ['catalog:read'],
    status: 'active',
    priority: 100,
    is_primary: true,
    last_test_at: null,
    last_test_ok: null,
    last_error: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    encrypted_secret: 'enc:original-secret',
  }

  it('rotating only the secret leaves app_key and is_primary untouched', async () => {
    const { db, rows } = fakeDb([{ ...EXISTING }])
    await saveCatalogIntegration(db, 'acct-1', 'user-1', {
      id: 'int-1',
      provider: 'budun',
      secret: 'rotated-secret',
    })
    const row = rows()[0]
    expect(row.encrypted_secret).toBe('enc:rotated-secret')
    expect(row.app_key).toBe('app-key-123') // NOT wiped
    expect(row.is_primary).toBe(true) // NOT demoted
  })

  it('updating base_url alone leaves the secret and app_key untouched', async () => {
    const { db, rows } = fakeDb([{ ...EXISTING }])
    await saveCatalogIntegration(db, 'acct-1', 'user-1', {
      id: 'int-1',
      provider: 'budun',
      baseUrl: 'https://new-erp.example.com',
    })
    const row = rows()[0]
    expect(row.base_url).toBe('https://new-erp.example.com')
    expect(row.encrypted_secret).toBe('enc:original-secret')
    expect(row.app_key).toBe('app-key-123')
  })

  it('explicitly clearing app_key (empty string) does set it to null', async () => {
    const { db, rows } = fakeDb([{ ...EXISTING }])
    await saveCatalogIntegration(db, 'acct-1', 'user-1', {
      id: 'int-1',
      provider: 'budun',
      appKey: '',
    })
    expect(rows()[0].app_key).toBeNull()
  })
})

describe('saveCatalogIntegration — single primary per account', () => {
  it('promoting one integration demotes every other active row on the account', async () => {
    const { db, rows } = fakeDb([
      { id: 'int-1', account_id: 'acct-1', is_primary: true, encrypted_secret: 'enc:a' },
      { id: 'int-2', account_id: 'acct-1', is_primary: false, encrypted_secret: 'enc:b' },
    ])
    await saveCatalogIntegration(db, 'acct-1', 'user-1', {
      id: 'int-2',
      provider: 'budun',
      isPrimary: true,
    })
    const byId = Object.fromEntries(rows().map((r) => [r.id, r]))
    expect(byId['int-2'].is_primary).toBe(true)
    expect(byId['int-1'].is_primary).toBe(false)
  })
})

describe('listCatalogIntegrations', () => {
  it('scopes strictly by the given accountId', async () => {
    const { db } = fakeDb([
      { id: 'int-1', account_id: 'acct-1', display_name: 'Mine' },
      { id: 'int-2', account_id: 'acct-2', display_name: 'Someone else' },
    ])
    const list = await listCatalogIntegrations(db, 'acct-1')
    expect(list).toHaveLength(1)
    expect(list[0].display_name).toBe('Mine')
  })
})
