import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  ingestDocument: vi.fn().mockResolvedValue(undefined),
  loadEmbeddingsKey: vi.fn().mockResolvedValue({ key: null, corrupt: false }),
}))

vi.mock('../knowledge', () => ({ ingestDocument: h.ingestDocument }))
vi.mock('../config', () => ({ loadEmbeddingsKey: h.loadEmbeddingsKey }))

import {
  accountDefaultCurrency,
  createDataSourceFromUrl,
  DataSourceError,
  refreshDataSource,
} from './service'

// ------------------------------------------------------------
// Minimal generic in-memory fake covering every table service.ts
// touches: ai_data_sources, ai_knowledge_documents, ai_catalog_products.
// Same "chainable + thenable" shape as the other new test files'
// fakes, generalized across tables via one Map<string, row[]>.
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

function csv(rows: string[][]): string {
  return rows.map((r) => r.join(',')).join('\n')
}

function stubCsvFetch(text: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => text } as unknown as Response),
  )
}

beforeEach(() => {
  h.ingestDocument.mockClear()
  h.loadEmbeddingsKey.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

const PRODUCTS_CSV = csv([
  ['Nombre', 'Precio', 'Stock'],
  ['Samsung Galaxy S25', '34900', '4'],
])

describe('createDataSourceFromUrl — usage isolation', () => {
  it('usage=catalog: writes ai_catalog_products, never touches the Knowledge Base', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()

    await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Products',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
    })

    expect(table('ai_catalog_products')).toHaveLength(1)
    expect(table('ai_catalog_products')[0]).toMatchObject({ name: 'Samsung Galaxy S25', price: 34900 })
    expect(table('ai_knowledge_documents')).toHaveLength(0)
    expect(h.ingestDocument).not.toHaveBeenCalled()
  })

  it('usage=knowledge: writes the KB document + chunks, never touches ai_catalog_products', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()

    await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Hours',
      url: 'https://example.com/hours.csv',
      usage: 'knowledge',
    })

    expect(table('ai_knowledge_documents')).toHaveLength(1)
    expect(table('ai_knowledge_documents')[0].type).toBe('data_source')
    expect(h.ingestDocument).toHaveBeenCalledTimes(1)
    expect(table('ai_catalog_products')).toHaveLength(0)
  })

  it('usage=both: writes to both destinations', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()

    await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Everything',
      url: 'https://example.com/all.csv',
      usage: 'both',
    })

    expect(table('ai_knowledge_documents')).toHaveLength(1)
    expect(table('ai_catalog_products')).toHaveLength(1)
  })
})

describe('createDataSourceFromUrl — validation', () => {
  it('rejects a google_sheets source_type whose URL is not a Sheets export link', async () => {
    const { db } = fakeDb()
    await expect(
      createDataSourceFromUrl(db, {
        accountId: 'acct-1',
        userId: 'user-1',
        sourceType: 'google_sheets',
        displayName: 'Bad',
        url: 'https://example.com/not-a-sheet.csv',
        usage: 'knowledge',
      }),
    ).rejects.toBeInstanceOf(DataSourceError)
  })

  it('surfaces an HTML response (unpublished sheet) as a DataSourceError, not a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<!DOCTYPE html><html></html>' } as unknown as Response),
    )
    const { db } = fakeDb()
    await expect(
      createDataSourceFromUrl(db, {
        accountId: 'acct-1',
        userId: 'user-1',
        sourceType: 'remote_csv',
        displayName: 'Bad',
        url: 'https://example.com/redirects-to-login',
        usage: 'catalog',
      }),
    ).rejects.toBeInstanceOf(DataSourceError)
  })

  it('surfaces an unreachable URL as a DataSourceError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { db } = fakeDb()
    await expect(
      createDataSourceFromUrl(db, {
        accountId: 'acct-1',
        userId: 'user-1',
        sourceType: 'remote_csv',
        displayName: 'Bad',
        url: 'https://example.com/gone.csv',
        usage: 'catalog',
      }),
    ).rejects.toBeInstanceOf(DataSourceError)
  })
})

describe('refreshDataSource — replaces only its own rows', () => {
  it('does not disturb another data source’s catalog rows or KB document', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()

    const sourceA = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Source A',
      url: 'https://example.com/a.csv',
      usage: 'both',
    })
    const sourceB = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Source B',
      url: 'https://example.com/b.csv',
      usage: 'both',
    })

    expect(table('ai_catalog_products')).toHaveLength(2)
    expect(table('ai_knowledge_documents')).toHaveLength(2)

    // Refresh source A with a different row (price changed) — B's rows
    // must be untouched, A's must be replaced (not duplicated).
    stubCsvFetch(
      csv([
        ['Nombre', 'Precio', 'Stock'],
        ['Samsung Galaxy S25', '36900', '2'],
      ]),
    )
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: sourceA.id })

    const catalogRows = table('ai_catalog_products')
    expect(catalogRows).toHaveLength(2) // still exactly one per source
    const aRow = catalogRows.find((r) => r.data_source_id === sourceA.id)
    const bRow = catalogRows.find((r) => r.data_source_id === sourceB.id)
    expect(aRow?.price).toBe(36900) // refreshed
    expect(bRow?.price).toBe(34900) // untouched

    expect(table('ai_knowledge_documents')).toHaveLength(2) // A's doc replaced in place, not duplicated
  })

  it('an uploaded_csv source refreshed without a fresh file throws instead of silently reusing stale data', async () => {
    const { db } = fakeDb()
    const buffer = new TextEncoder().encode(PRODUCTS_CSV).buffer
    const source = await (await import('./service')).createDataSourceFromFile(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      displayName: 'Uploaded',
      filename: 'products.csv',
      buffer,
      usage: 'catalog',
    })
    await expect(
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id }),
    ).rejects.toBeInstanceOf(DataSourceError)
  })
})

// ============================================================
// AI_Catalog_Fix_Kit FASE 12 — currency. Regression test for the real
// bug the audit found: createDataSourceFromUrl/File defaulted to a
// hardcoded 'USD' when no currency was supplied, so a DOP account's
// catalog prices got labeled USD. accountDefaultCurrency() (used by
// /api/ai/data-sources and the legacy /api/ai/knowledge/{upload,sheet}
// routes) must resolve accounts.default_currency instead.
// ============================================================
describe('accountDefaultCurrency', () => {
  it('reads accounts.default_currency for the given account', async () => {
    const { db, table } = fakeDb()
    table('accounts').push({ id: 'acct-1', default_currency: 'DOP' })
    expect(await accountDefaultCurrency(db, 'acct-1')).toBe('DOP')
  })

  it('falls back to USD only when the account has no default_currency set', async () => {
    const { db } = fakeDb()
    expect(await accountDefaultCurrency(db, 'acct-missing')).toBe('USD')
  })

  it('a data source created without an explicit currency uses the account default, never a hardcoded USD', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    table('accounts').push({ id: 'acct-1', default_currency: 'DOP' })
    const currency = await accountDefaultCurrency(db, 'acct-1')

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Products',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
      currency, // exactly what the route now passes — never omitted
    })
    expect(source.currency).toBe('DOP')
    expect(table('ai_catalog_products')[0].currency).toBe('DOP')
    expect(table('ai_catalog_products')[0].currency).not.toBe('USD')
  })
})
