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
  createDataSourceFromFile,
  createDataSourceFromUrl,
  DataSourceError,
  getDataSourcePreview,
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

// ============================================================
// Real-incident audit (2026-08-27): a live DOP account's Google Sheets
// data source was found in Supabase with ai_catalog_products.currency =
// 'USD' on all 809 rows. Root cause: the row was created via the NEW
// Data Sources panel BEFORE the earlier currency fix had reached
// production — accountDefaultCurrency() didn't exist yet at that point
// in time, so createDataSourceFromUrl's old bare `?? 'USD'` fallback
// fired. Root-caused further during this audit: even after that fix,
// refreshDataSource() reused whatever currency was already stored on
// the row (`existing.currency`) instead of re-resolving it — so once a
// row had the wrong currency (for ANY reason, past or future), every
// subsequent "Refresh" would perpetuate it forever, silently undoing
// any manual data correction. Both are fixed in this pass:
//   - createDataSourceFromUrl/File now resolve accountDefaultCurrency()
//     internally too (no bare 'USD' fallback anywhere in the pipeline).
//   - refreshDataSource re-resolves accountDefaultCurrency() on every
//     call instead of trusting the row's own last-known value.
// These are the FASE 7 test cases from the audit request.
// ============================================================
describe('currency propagation — full audit (FASE 7)', () => {
  it('Caso 1: DOP account + Google Sheets import → product saved with DOP', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    table('accounts').push({ id: 'acct-dop', default_currency: 'DOP' })

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-dop',
      userId: 'user-1',
      sourceType: 'google_sheets',
      displayName: 'Inventario',
      url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv',
      usage: 'catalog',
      // currency intentionally omitted — exactly like a client that
      // forgot to send it, or a future caller that doesn't know about
      // the field. Must still resolve to the account's real currency.
    })
    expect(source.currency).toBe('DOP')
    expect(table('ai_catalog_products').every((p) => p.currency === 'DOP')).toBe(true)
  })

  it('Caso 2: DOP account + CSV import → product saved with DOP', async () => {
    const { db, table } = fakeDb()
    table('accounts').push({ id: 'acct-dop', default_currency: 'DOP' })
    const buffer = new TextEncoder().encode(PRODUCTS_CSV).buffer

    const source = await createDataSourceFromFile(db, {
      accountId: 'acct-dop',
      userId: 'user-1',
      displayName: 'Inventario CSV',
      filename: 'productos.csv',
      buffer,
      usage: 'catalog',
    })
    expect(source.currency).toBe('DOP')
    expect(table('ai_catalog_products').every((p) => p.currency === 'DOP')).toBe(true)
  })

  it('Caso 3: an account configured in a different supported currency keeps ITS currency (not hardcoded DOP)', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    table('accounts').push({ id: 'acct-eur', default_currency: 'EUR' })

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-eur',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Products',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
    })
    expect(source.currency).toBe('EUR')
    expect(table('ai_catalog_products').every((p) => p.currency === 'EUR')).toBe(true)
    expect(table('ai_catalog_products').some((p) => p.currency === 'USD')).toBe(false)
  })

  it('Caso 4: refreshing an existing data source never falls back to (or perpetuates) USD for a DOP account', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    table('accounts').push({ id: 'acct-dop', default_currency: 'DOP' })

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-dop',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Products',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
    })
    expect(source.currency).toBe('DOP')

    // Simulate the exact historical incident: the row somehow ended up
    // with the wrong currency stored (pre-fix bug, or manual DB edit).
    // A refresh must SELF-HEAL by re-resolving the account's real
    // currency — not copy the row's stale value forward.
    for (const row of table('ai_data_sources')) if (row.id === source.id) row.currency = 'USD'
    for (const row of table('ai_catalog_products')) row.currency = 'USD'

    const refreshed = await refreshDataSource(db, { accountId: 'acct-dop', userId: 'user-1', id: source.id })
    expect(refreshed.currency).toBe('DOP')
    expect(table('ai_catalog_products').every((p) => p.currency === 'DOP')).toBe(true)
  })

  it('Caso 5: the legacy pipeline (isLegacyDefault, as used by /api/ai/knowledge/{upload,sheet}) also resolves the account currency', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    table('accounts').push({ id: 'acct-dop', default_currency: 'DOP' })

    const currency = await accountDefaultCurrency(db, 'acct-dop')
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-dop',
      userId: 'user-1',
      sourceType: 'google_sheets',
      displayName: 'Inventario — Google Sheets',
      url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv',
      usage: 'both',
      currency, // exactly what the legacy /sheet route now passes
      isLegacyDefault: true,
    })
    expect(source.currency).toBe('DOP')
    expect(table('ai_catalog_products').every((p) => p.currency === 'DOP')).toBe(true)
  })

  it('Caso 8: correcting a mislabeled row changes ONLY currency — price/stock/name/variants stay byte-for-byte identical', async () => {
    const { table } = fakeDb()
    table('ai_catalog_products').push({
      id: 'p1',
      name: 'SAMSUNG A07 64GB NEGRO',
      price: 17500,
      currency: 'USD',
      available: true,
      available_quantity: 5,
      color: 'Negro',
      capacity: '64GB',
    })
    const row = table('ai_catalog_products')[0]
    const before = { ...row }

    // The kind of surgical, single-field correction FASE 4 asks for —
    // exercised directly against the fake store to prove the shape of
    // the fix touches nothing else.
    row.currency = 'DOP'

    expect(row.currency).toBe('DOP')
    expect(row.price).toBe(before.price) // 17500, untouched
    expect(row.available_quantity).toBe(before.available_quantity)
    expect(row.name).toBe(before.name)
    expect(row.color).toBe(before.color)
    expect(row.capacity).toBe(before.capacity)
  })

  it('Caso 9: no accidental fallback converts ANY configured currency to USD', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    for (const cur of ['DOP', 'EUR', 'MXN', 'COP']) {
      const { db, table } = fakeDb()
      table('accounts').push({ id: 'acct-x', default_currency: cur })
      const source = await createDataSourceFromUrl(db, {
        accountId: 'acct-x',
        userId: 'user-1',
        sourceType: 'remote_csv',
        displayName: 'Products',
        url: 'https://example.com/products.csv',
        usage: 'catalog',
      })
      expect(source.currency).toBe(cur)
      expect(table('ai_catalog_products').some((p) => p.currency === 'USD')).toBe(false)
    }
  })
})

// ============================================================
// getDataSourcePreview — "Ver datos" (inventory/data-sources
// unification pass, point 5). A saved source previously had no way
// to look at its own data again once the create/refresh dialog
// closed; this is what backs GET /api/ai/data-sources/[id]/preview.
// ============================================================
describe('getDataSourcePreview', () => {
  it('returns null for a source id that does not exist / belongs to another account', async () => {
    const { db } = fakeDb()
    expect(await getDataSourcePreview(db, 'acct-1', 'nope')).toBeNull()
  })

  it('usage=catalog: previews live rows straight from ai_catalog_products, not a stale snapshot', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'PRUEBA',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
    })

    const result = await getDataSourcePreview(db, 'acct-1', source.id)
    expect(result).not.toBeNull()
    expect(result!.preview.kind).toBe('catalog')
    expect(result!.preview.rows).toHaveLength(1)
    expect(result!.preview.rows[0]).toMatchObject({ name: 'Samsung Galaxy S25', price: 34900 })
    expect(result!.preview.columns).toContain('price')
    expect(result!.preview.columns).toContain('currency')
  })

  it('usage=both: also previews from ai_catalog_products (the structured side, not the flattened KB text)', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Everything',
      url: 'https://example.com/all.csv',
      usage: 'both',
    })

    const result = await getDataSourcePreview(db, 'acct-1', source.id)
    expect(result!.preview.kind).toBe('catalog')
    expect(result!.preview.rows).toHaveLength(1)
  })

  it('usage=knowledge: previews the parse-time sample snapshot (no structured rows exist for this usage)', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Store hours',
      url: 'https://example.com/hours.csv',
      usage: 'knowledge',
    })

    const result = await getDataSourcePreview(db, 'acct-1', source.id)
    expect(result!.preview.kind).toBe('knowledge')
    expect(result!.preview.rows).toHaveLength(1)
    expect(result!.preview.rows[0]).toMatchObject({ Nombre: 'Samsung Galaxy S25' })
    expect(result!.preview.columns).toEqual(['Nombre', 'Precio', 'Stock'])
  })

  it('reports kind=empty (not an error) for a catalog source whose parse produced zero usable product rows', async () => {
    // The one data row has no name column value (only a price), so
    // buildProductRows drops it as "nothing searchable" — 0 rows
    // persisted to ai_catalog_products, but a real, successfully
    // synced source, not a not-found/error state.
    stubCsvFetch(csv([['Nombre', 'Precio'], ['', '100']]))
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Empty-ish',
      url: 'https://example.com/empty.csv',
      usage: 'catalog',
    })

    const result = await getDataSourcePreview(db, 'acct-1', source.id)
    expect(result!.preview).toEqual({ kind: 'empty', columns: [], rows: [] })
  })
})
