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
  DataSourceRefreshInProgressError,
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
  // Bug #1 regression tests need to simulate a genuine INSERT failure
  // (network blip, oversized payload, ...) on a specific table, exactly
  // once, without otherwise changing the fake's behavior. Marking a
  // table here makes its NEXT insert() call return a Postgrest-shaped
  // error instead of writing anything — then clears itself so later
  // inserts (e.g. a subsequent successful refresh) behave normally.
  const failNextInsert = new Set<string>()
  // Same idea as failNextInsert, but for UPDATE — needed to simulate a
  // real PostgREST schema error (e.g. a column the live database
  // doesn't have yet) on `claimDataSourceRefresh`'s own `.update()`,
  // which is a distinct failure mode from "someone else already holds
  // the claim" (DataSourceRefreshInProgressError) and must be
  // distinguishable from it.
  const failNextUpdate = new Set<string>()
  // Same idea again, for UPSERT — needed to simulate a genuine write
  // failure (Prueba 7: "error de escritura") on the catalog save step
  // itself, distinct from a unique-constraint collision the upsert is
  // specifically meant to NOT hit.
  const failNextUpsert = new Set<string>()
  // Same idea, for DELETE — needed to prove a failure on the obsolete-
  // row cleanup (e.g. a real "Bad Request" from an oversized `.in()`
  // list) is surfaced as a DataSourceError, not silently swallowed.
  const failNextDelete = new Set<string>()
  // Records every `.in('id', [...])` list a DELETE call on
  // ai_catalog_products actually used — lets a test assert the
  // obsolete-row cleanup is chunked (no single call exceeds the real
  // PostgREST URL-length limit that caused the production incident)
  // instead of one unbounded `.in()` over the whole previous catalog.
  const deleteInBatchSizes: number[] = []

  function builder(
    tableName: string,
    op: 'select' | 'update' | 'insert' | 'upsert' | 'delete',
    payload?: Record<string, unknown> | Record<string, unknown>[],
    onConflict?: string,
  ) {
    const filters: [string, unknown, 'eq' | 'in'][] = []
    // PostgREST `.or('col.is.null,col.lt.<value>')` — supports exactly
    // the two operators H-5's claim query needs. ANDed with the plain
    // `.eq()`/`.in()` filters above, matching real PostgREST semantics
    // (this is a faithful model of the single atomic `UPDATE ... WHERE
    // ... RETURNING` PostgREST issues — see the comment on the
    // concurrency tests below for exactly what this fake can and cannot
    // prove).
    let orClauses: [string, 'is' | 'lt', string][] | null = null
    // Models PostgREST's real default page cap (1,000 rows on the real
    // project — see the AI agent audit fix in service.ts): a plain
    // `.select()` with no `.range()` only returns the first
    // DEFAULT_PAGE_SIZE rows, however many actually match.
    const DEFAULT_PAGE_SIZE = 1000
    let range: [number, number] | null = null
    const api = {
      select: () => api,
      range: (from: number, to: number) => {
        range = [from, to]
        return api
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val, 'eq'])
        return api
      },
      in: (col: string, vals: unknown[]) => {
        filters.push([col, vals, 'in'])
        return api
      },
      or: (expr: string) => {
        orClauses = expr.split(',').map((clause) => {
          const [col, cmpOp, ...rest] = clause.split('.')
          return [col, cmpOp as 'is' | 'lt', rest.join('.')]
        })
        return api
      },
      order: () => api,
      limit: () => api,
      single: () => run(true),
      maybeSingle: () => run(true),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => run(false).then(resolve, reject),
    }
    const rows = table(tableName)
    const matchesOr = (row: Record<string, unknown>) => {
      if (!orClauses) return true
      return orClauses.some(([col, cmpOp, val]) => {
        const current = row[col]
        if (cmpOp === 'is') return val === 'null' ? current === null || current === undefined : current === val
        if (cmpOp === 'lt') return typeof current === 'string' && current < val
        return false
      })
    }
    const matches = (row: Record<string, unknown>) =>
      filters.every(([col, val, mode]) => (mode === 'in' ? (val as unknown[]).includes(row[col]) : row[col] === val)) &&
      matchesOr(row)

    async function run(singleResult: boolean) {
      if (op === 'select') {
        const matched = rows.filter(matches)
        if (singleResult) return { data: matched[0] ?? null, error: null }
        const [from, to] = range ?? [0, DEFAULT_PAGE_SIZE - 1]
        return { data: matched.slice(from, to + 1), error: null }
      }
      if (op === 'update') {
        if (failNextUpdate.has(tableName)) {
          failNextUpdate.delete(tableName)
          return { data: null, error: { message: `column ${tableName}.simulated does not exist` } }
        }
        // Real PostgREST evaluates the WHERE clause (all filters, incl.
        // `.or()`) against the CURRENT row state and applies the SET in
        // one atomic SQL statement — so the match check must run before
        // any mutation, exactly once per call, never re-evaluated after
        // a partial write. This synchronous filter+assign is the
        // faithful part of that model this in-memory fake CAN provide.
        const matched = rows.filter(matches)
        for (const row of matched) Object.assign(row, payload)
        return singleResult ? { data: matched[0] ?? null, error: null } : { data: matched, error: null }
      }
      if (op === 'insert') {
        if (failNextInsert.has(tableName)) {
          failNextInsert.delete(tableName)
          return { data: null, error: { message: `simulated insert failure on ${tableName}` } }
        }
        const items = Array.isArray(payload) ? payload : [payload as Record<string, unknown>]
        const inserted = items.map((p) => ({ id: `${tableName}-${nextId++}`, ...p }))
        rows.push(...inserted)
        return singleResult ? { data: inserted[0] ?? null, error: null } : { data: inserted, error: null }
      }
      if (op === 'upsert') {
        if (failNextUpsert.has(tableName)) {
          failNextUpsert.delete(tableName)
          return { data: null, error: { message: `simulated upsert failure on ${tableName}` } }
        }
        // Faithful to real Postgres `ON CONFLICT (...) DO UPDATE`: the
        // conflict target is the exact column list `onConflict` names
        // (comma-separated, matching the real `.upsert(rows, {
        // onConflict })` call shape) — an existing row matching on ALL
        // of those columns is updated in place (same `id`, never a new
        // one); anything else is inserted fresh.
        const conflictCols = (onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean)
        const items = Array.isArray(payload) ? payload : [payload as Record<string, unknown>]
        for (const item of items) {
          const existing = conflictCols.length > 0
            ? rows.find((r) => conflictCols.every((c) => r[c] === item[c]))
            : undefined
          if (existing) {
            Object.assign(existing, item)
          } else {
            rows.push({ id: `${tableName}-${nextId++}`, ...item })
          }
        }
        return { data: null, error: null }
      }
      if (op === 'delete') {
        const inFilter = filters.find(([, , mode]) => mode === 'in')
        if (tableName === 'ai_catalog_products' && inFilter) {
          deleteInBatchSizes.push((inFilter[1] as unknown[]).length)
        }
        if (failNextDelete.has(tableName)) {
          failNextDelete.delete(tableName)
          return { data: null, error: { message: `simulated delete failure on ${tableName}` } }
        }
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
        insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => builder(name, 'insert', payload),
        upsert: (payload: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) =>
          builder(name, 'upsert', payload, opts?.onConflict),
        delete: () => builder(name, 'delete'),
      }),
    } as unknown as SupabaseClient,
    table,
    failNextInsertOn: (name: string) => failNextInsert.add(name),
    failNextUpdateOn: (name: string) => failNextUpdate.add(name),
    failNextUpsertOn: (name: string) => failNextUpsert.add(name),
    failNextDeleteOn: (name: string) => failNextDelete.add(name),
    deleteInBatchSizes,
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

  // ----------------------------------------------------------
  // Audit follow-up (same day): assertGoogleSheetsUrl() used to accept
  // any URL whose full string CONTAINED 'docs.google.com/spreadsheets'
  // anywhere — a substring match, not a hostname check. That let a
  // 'google_sheets' source actually point at an attacker-controlled
  // host, e.g. the attacker's own domain with a matching path, or a
  // lookalike subdomain that merely starts with the expected string.
  // Now fixed to require the REAL parsed hostname to be exactly
  // 'docs.google.com'. This is independent of the SSRF fix
  // (assertSafeUrl) below — assertSafeUrl already validates the real
  // resolved host/IP for every source type; this fix is about a
  // 'google_sheets'-labeled source not silently being an unrelated host.
  // ----------------------------------------------------------
  it('accepts a legitimate Google Sheets export URL (real hostname docs.google.com)', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'google_sheets',
      displayName: 'Inventario',
      url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv',
      usage: 'knowledge',
    })
    expect(source.source_type).toBe('google_sheets')
  })

  it('rejects a lookalike URL whose real host is the ATTACKER\'s domain, with the expected string only in the path', async () => {
    const { db } = fakeDb()
    await expect(
      createDataSourceFromUrl(db, {
        accountId: 'acct-1',
        userId: 'user-1',
        sourceType: 'google_sheets',
        displayName: 'Evil',
        url: 'https://evil.com/docs.google.com/spreadsheets/d/x/export?format=csv',
        usage: 'knowledge',
      }),
    ).rejects.toBeInstanceOf(DataSourceError)
  })

  it('rejects a lookalike SUBDOMAIN whose real host is docs.google.com.evil.com, not docs.google.com', async () => {
    const { db } = fakeDb()
    await expect(
      createDataSourceFromUrl(db, {
        accountId: 'acct-1',
        userId: 'user-1',
        sourceType: 'google_sheets',
        displayName: 'Evil',
        url: 'https://docs.google.com.evil.com/spreadsheets/d/x/export?format=csv',
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
// Bug #1 fix — refresh atomicity. persistDataSource() used to DELETE a
// source's existing ai_catalog_products/ai_knowledge_documents rows
// BEFORE inserting the new ones, with no transaction. A failed insert
// after a successful delete left the account with an empty catalog/KB
// document for that source, with no rollback. Fixed by inserting the
// new generation first and only removing the previous one once that
// succeeds — these tests fail against the pre-fix code (the previous
// rows would already be gone by the time the insert error is thrown)
// and pass against the fix.
// ============================================================
describe('refreshDataSource — Bug #1 fix: refresh atomicity', () => {
  it('a failed catalog write (upsert) during a refresh preserves the PREVIOUS generation of rows', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table, failNextUpsertOn } = fakeDb()

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Source',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
    })
    const originalRows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(originalRows).toHaveLength(1) // sanity: the source really has a row to lose

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto Nuevo', '999', '1']]))
    failNextUpsertOn('ai_catalog_products')

    await expect(
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id }),
    ).rejects.toBeTruthy()

    // This is the exact bug: against the pre-fix code, the DELETE had
    // already run before the failed INSERT, so this would be empty.
    const survivingRows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(survivingRows).toHaveLength(1)
    expect(survivingRows[0].name).toBe('Samsung Galaxy S25') // the ORIGINAL row, untouched
  })

  it('a failed INSERT into ai_knowledge_documents during a refresh preserves the PREVIOUS document (same root cause, knowledge side)', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table, failNextInsertOn } = fakeDb()

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Source',
      url: 'https://example.com/products.csv',
      usage: 'knowledge',
    })
    const originalDocs = table('ai_knowledge_documents').filter((d) => d.data_source_id === source.id)
    expect(originalDocs).toHaveLength(1)
    const originalDocId = originalDocs[0].id

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto Nuevo', '999', '1']]))
    failNextInsertOn('ai_knowledge_documents')

    await expect(
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id }),
    ).rejects.toBeTruthy()

    // Pre-fix, the old document was deleted before the new insert was
    // even attempted — this would be empty.
    const survivingDocs = table('ai_knowledge_documents').filter((d) => d.data_source_id === source.id)
    expect(survivingDocs).toHaveLength(1)
    expect(survivingDocs[0].id).toBe(originalDocId)
    expect(survivingDocs[0].content).toContain('Samsung Galaxy S25') // the ORIGINAL content
  })

  it('a SUCCESSFUL refresh still replaces the previous generation cleanly — no duplicates left behind', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Source',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
    })
    expect(table('ai_catalog_products')).toHaveLength(1)

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto Nuevo', '999', '1']]))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(1) // replaced, not appended
    expect(rows[0].name).toBe('Producto Nuevo')
  })

  it('DOCUMENTED, UNCHANGED behavior: a refresh that legitimately parses zero catalog-eligible rows still empties the previous catalog (not a failure)', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Source',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
    })
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === source.id)).toHaveLength(1)

    // A CSV that parses successfully — buildInventory does not reject
    // it, `dataRows.length` is 2 — but produces ZERO catalog-eligible
    // rows: no header matches the `name` synonyms, and every row's
    // first cell (buildProductRows' last-resort name fallback,
    // `cell(row, 0)`) is empty too. Both of buildProductRows' only ways
    // to find a name come up empty for every row, so `products` ends up
    // genuinely empty even though the sync itself succeeded.
    stubCsvFetch(csv([['Precio', 'Stock'], ['', '100'], ['', '200']]))
    const result = await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })

    // Not an error — the refresh completes normally...
    expect(result.source.status).toBe('active')
    // ...and the previous generation IS still removed: this is the
    // documented, UNCHANGED behavior from before the Bug #1 fix — the
    // source genuinely has zero catalog rows right now, so leaving the
    // stale ones behind would misrepresent its real current content.
    // Only a genuine INSERT ERROR (a different code path, tested above)
    // is now non-destructive — a legitimate zero-row result never was,
    // and still isn't, treated as one.
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === source.id)).toHaveLength(0)
  })
})

// ============================================================
// H-5 fix (Punto 5 audit) — refresh mutual exclusion. Two concurrent
// refreshes of the SAME data_source_id used to be able to interleave
// their own insert-then-delete-previous sequences (the exact mechanism
// the Bug #1 suite above protects, but for a SINGLE in-flight refresh
// only) and leave duplicates, or let one process delete rows the other
// just inserted. refreshDataSource() now atomically claims the source
// (ai_data_sources.refresh_started_at, via a single PostgREST
// UPDATE...WHERE...RETURNING) before doing any work, and always
// releases the claim in a `finally`.
//
// EPISTEMOLOGICAL LIMIT — read before citing these tests: fakeDb()'s
// `.or()`/`run()` model faithfully reproduces PostgREST's single-
// statement atomicity (the match-and-write happens synchronously within
// one microtask, never split across an await), which is what lets two
// racing `refreshDataSource()` calls in this suite genuinely exercise
// BOTH the claim-succeeds and claim-fails branches of the real code —
// this is not a mock that assumes its own conclusion. What it CANNOT
// prove is that PostgreSQL's own MVCC row-locking gives that same
// atomicity under two genuinely simultaneous network requests against a
// live database — that guarantee is PostgreSQL's, not something any
// fake-client test can demonstrate. This sandbox has no Docker/local
// Supabase available to run that as a real integration test (same
// constraint documented throughout this engagement's tests/rls/ suite).
// ============================================================
// ============================================================
// Stable identity via `id_producto` (externalId) + idempotent catalog
// writes — regression coverage for the real production incident this
// fixes: migration 059's `UNIQUE(data_source_id, source_product_id)`
// index made a normal re-sync of unchanged inventory (same row-index
// or SKU ids as the still-present previous generation) fail the whole
// refresh with a raw Postgres unique-violation error, surfaced to the
// admin as the generic "Refresh failed." — while `ai_data_sources`'
// metadata (row_count, last_synced_at, preview_sample) had ALREADY
// been written successfully moments earlier, making the UI look like
// the sync had partially worked. Fixed by (a) upserting instead of
// inserting the new generation, and (b) preferring a dedicated
// `id_producto`-style column over the row-index fallback, so identity
// survives the sheet's row order changing too.
// ============================================================
function idRow(idProducto: string, name: string, cantidad: string, precio: string): string[] {
  return [idProducto, name, cantidad, precio]
}
function idCsv(rows: string[][]): string {
  return csv([['id_producto', 'producto', 'cantidad', 'precio_ud'], ...rows])
}

describe('persistDataSource — stable identity via id_producto + idempotent catalog writes', () => {
  it('Prueba 2 — the SAME inventory synced twice with the SAME id_producto values succeeds (no unique-violation) and does not duplicate rows', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200'), idRow('2762', 'Abanico de pedestal', '14', '1200')]))
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === source.id)).toHaveLength(2)

    // Re-sync — byte-identical inventory, same two id_producto values.
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200'), idRow('2762', 'Abanico de pedestal', '14', '1200')]))
    await expect(
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id }),
    ).resolves.toBeTruthy()

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(2) // never 4 — no duplicates
    expect(new Set(rows.map((r) => r.source_product_id))).toEqual(new Set(['2761', '2762']))
  })

  it('Prueba 3 — a changed cantidad/precio for the SAME id_producto is reflected after refresh, on the SAME row (same DB id)', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200')]))
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })
    const before = table('ai_catalog_products').find((r) => r.source_product_id === '2761')!
    expect(before.available_quantity).toBe(11)
    expect(before.price).toBe(1200)

    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '5', '1350')]))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })

    const after = table('ai_catalog_products').find((r) => r.source_product_id === '2761')!
    expect(after.id).toBe(before.id) // updated in place, not replaced
    expect(after.available_quantity).toBe(5)
    expect(after.price).toBe(1350)
  })

  it('Prueba 4 — reordering rows in the sheet never swaps which product gets which data', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200'), idRow('2762', 'Abanico de pedestal', '14', '1500')]))
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })

    // Same two products, rows SWAPPED.
    stubCsvFetch(idCsv([idRow('2762', 'Abanico de pedestal', '14', '1500'), idRow('2761', 'Abanico de pared', '11', '1200')]))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.source_product_id === '2761')?.name).toBe('Abanico de pared')
    expect(rows.find((r) => r.source_product_id === '2762')?.name).toBe('Abanico de pedestal')
  })

  it('Prueba 5 — a brand-new id_producto added to the sheet is incorporated without disturbing existing products', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200')]))
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })

    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200'), idRow('9999', 'Producto Nuevo', '3', '500')]))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.source_product_id === '9999')?.name).toBe('Producto Nuevo')
    expect(rows.find((r) => r.source_product_id === '2761')?.name).toBe('Abanico de pared')
  })

  it('Prueba 6 — a product removed from the sheet disappears from the catalog after a successful refresh', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200'), idRow('2762', 'Abanico de pedestal', '14', '1500')]))
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })

    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200')])) // 2762 removed
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].source_product_id).toBe('2761')
  })

  // ============================================================
  // Real defect found auditing the AI agent (Oct 2026): the obsolete-
  // row cleanup below used to issue ONE `.in('id', idsToRemove)` call
  // with every id to remove. A refresh that transitions a large catalog
  // from one identity scheme to another (e.g. row-N → id_producto) can
  // need to remove the ENTIRE previous generation at once — confirmed in
  // production at ~1,100+ ids, which failed with a bare "Bad Request"
  // (a URL-length limit, not a logic error). That exception still threw
  // DataSourceError and marked the source 'error' correctly, but by then
  // the upsert had ALREADY written every new row, so the account was
  // left with BOTH generations live at once (2,287 rows for a source
  // whose own row_count said 1,143) — search_catalog silently returning
  // duplicates/stale data for every product, inconsistently from one
  // call to the next.
  // ============================================================
  it('a refresh that must remove MANY obsolete rows at once (identity-scheme transition) chunks the delete instead of one unbounded .in() call', async () => {
    const OLD_COUNT = 450 // 3 chunks of ≤200 at the current chunk size
    const oldRows = Array.from({ length: OLD_COUNT }, (_, i) => idRow(`old-${i}`, `Producto ${i}`, '1', '100'))
    stubCsvFetch(idCsv(oldRows))
    const { db, table, deleteInBatchSizes } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === source.id)).toHaveLength(OLD_COUNT)

    // Identity scheme changes entirely — every old id_producto is gone,
    // replaced by a brand-new set. ALL 450 old rows must be removed.
    const newRows = Array.from({ length: OLD_COUNT }, (_, i) => idRow(`new-${i}`, `Producto ${i}`, '1', '100'))
    stubCsvFetch(idCsv(newRows))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(OLD_COUNT) // old generation fully removed, never doubled
    expect(rows.every((r) => (r.source_product_id as string).startsWith('new-'))).toBe(true)

    // The cleanup issued MULTIPLE delete calls, none exceeding the chunk
    // size — never one call with all 450 ids inline.
    expect(deleteInBatchSizes.length).toBeGreaterThan(1)
    for (const size of deleteInBatchSizes) expect(size).toBeLessThanOrEqual(200)
    expect(deleteInBatchSizes.reduce((a, b) => a + b, 0)).toBe(OLD_COUNT)
  })

  // ============================================================
  // Real defect found auditing the AI agent (Oct 2026), discovered
  // immediately after the chunked-delete fix above went to production:
  // the chunking fixed the DELETE side, but the SELECT that reads the
  // previous generation (to compute which ids are even obsolete) had
  // no `.range()` at all — PostgREST caps an unranged `.select()` at
  // its default page size (1,000 rows on the real project) regardless
  // of how many rows actually match. For a source whose existing
  // catalog already exceeds 1,000 (exactly what the identity-scheme
  // transition incident left behind: 2,287 rows), `previous` only ever
  // saw the first page, so the obsolete-row diff permanently missed
  // whatever fell on later pages — those rows could never be cleaned
  // up by ANY future refresh, each one silently falling outside the
  // page again. Confirmed live: after deploying the chunked-delete fix
  // alone and running one real sync, 145 of 1,144 stale rows survived.
  // ============================================================
  it('a source with MORE than 1,000 pre-existing rows still has ALL of them correctly identified as obsolete — not just the first page', async () => {
    const OLD_COUNT = 1200 // exceeds the real project's 1,000-row default page size
    const oldRows = Array.from({ length: OLD_COUNT }, (_, i) => idRow(`old-${i}`, `Producto ${i}`, '1', '100'))
    stubCsvFetch(idCsv(oldRows))
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === source.id)).toHaveLength(OLD_COUNT)

    // Identity scheme changes entirely, same as the chunking test above
    // — every one of the 1,200 old rows must be removed, including the
    // 200 that fall past the first 1,000-row page.
    const newRows = Array.from({ length: OLD_COUNT }, (_, i) => idRow(`new-${i}`, `Producto ${i}`, '1', '100'))
    stubCsvFetch(idCsv(newRows))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(OLD_COUNT) // exactly the new generation — zero stragglers from any page
    expect(rows.every((r) => (r.source_product_id as string).startsWith('new-'))).toBe(true)
    expect(rows.some((r) => (r.source_product_id as string).startsWith('old-'))).toBe(false)
  })

  it('a genuine failure removing obsolete rows (e.g. the real "Bad Request" this project hit) is wrapped in DataSourceError, never silently left as a doubled catalog', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200'), idRow('2762', 'Abanico de pedestal', '14', '1500')]))
    const { db, table, failNextDeleteOn } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })

    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200')])) // 2762 removed
    failNextDeleteOn('ai_catalog_products')
    const attempt = refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })
    await expect(attempt).rejects.toBeInstanceOf(DataSourceError)
    await expect(attempt).rejects.toThrow(/Could not remove obsolete catalog rows/)

    const dsRow = table('ai_data_sources').find((r) => r.id === source.id)!
    expect(dsRow.status).toBe('error')
    expect(dsRow.last_error).toMatch(/Could not remove obsolete catalog rows/)
  })

  it('Prueba 7 — a genuine write failure during the catalog upsert preserves the previous rows AND marks the source with a diagnosable error, never "Refresh failed."', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200')]))
    const { db, table, failNextUpsertOn } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })

    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '5', '1350')]))
    failNextUpsertOn('ai_catalog_products')
    const attempt = refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })
    await expect(attempt).rejects.toBeInstanceOf(DataSourceError)
    await expect(attempt).rejects.toThrow(/Could not save catalog rows/)

    // The OLD row (quantity 11, price 1200) survives untouched — never
    // cleared, never silently replaced by the failed write's bad data.
    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].available_quantity).toBe(11)
    expect(rows[0].price).toBe(1200)
    // The source is marked with a SPECIFIC, diagnosable error — the
    // whole point of wrapping (not re-throwing raw) — never falsely
    // left looking synced.
    const dsRow = table('ai_data_sources').find((r) => r.id === source.id)!
    expect(dsRow.status).toBe('error')
    expect(dsRow.last_error).toMatch(/Could not save catalog rows/)
    expect(dsRow.last_error).not.toBe('Refresh failed.')
  })

  it('Prueba 10 — two DIFFERENT data sources may share the same id_producto values without interfering with each other', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Fuente A — Abanico', '11', '1200')]))
    const { db, table } = fakeDb()
    const sourceA = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Fuente A', url: 'https://docs.google.com/spreadsheets/d/a/export?format=csv', usage: 'catalog',
    })
    stubCsvFetch(idCsv([idRow('2761', 'Fuente B — Otro producto', '3', '999')]))
    const sourceB = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Fuente B', url: 'https://docs.google.com/spreadsheets/d/b/export?format=csv', usage: 'catalog',
    })

    const rowA = table('ai_catalog_products').find((r) => r.data_source_id === sourceA.id)!
    const rowB = table('ai_catalog_products').find((r) => r.data_source_id === sourceB.id)!
    expect(rowA.source_product_id).toBe('2761')
    expect(rowB.source_product_id).toBe('2761')
    expect(rowA.name).toBe('Fuente A — Abanico')
    expect(rowB.name).toBe('Fuente B — Otro producto')

    // Refreshing A never touches B's row with the same source_product_id.
    stubCsvFetch(idCsv([idRow('2761', 'Fuente A — Abanico renombrado', '11', '1200')]))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: sourceA.id })
    expect(table('ai_catalog_products').find((r) => r.data_source_id === sourceB.id)?.name).toBe('Fuente B — Otro producto')
  })

  it('Prueba 9 (parte de servicio) — id_producto drives source_product_id but NEVER populates the agent-visible `sku` field', async () => {
    stubCsvFetch(idCsv([idRow('2761', 'Abanico de pared', '11', '1200')]))
    const { db, table } = fakeDb()
    await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'google_sheets',
      displayName: 'Consultas KC', url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv', usage: 'catalog',
    })

    const row = table('ai_catalog_products').find((r) => r.source_product_id === '2761')!
    expect(row.sku).toBeNull() // id_producto is NOT a customer-facing SKU
    expect(row.name).toBe('Abanico de pared')
  })
})

describe('refreshDataSource — H-5 fix: refresh mutual exclusion', () => {
  it('sequential refreshes of the same source both succeed, and the claim is clear afterward', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'Source', url: 'https://example.com/products.csv', usage: 'catalog',
    })

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto Nuevo', '999', '1']]))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })
    expect(table('ai_data_sources').find((r) => r.id === source.id)?.refresh_started_at).toBeNull()

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Otro Producto', '500', '2']]))
    await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === source.id)).toHaveLength(1)
  })

  it('two concurrent refreshes of the SAME source: exactly one proceeds, the other is rejected with DataSourceRefreshInProgressError — no duplicates, nothing incorrectly deleted', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'Source', url: 'https://example.com/products.csv', usage: 'catalog',
    })

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto Concurrente', '777', '3']]))
    const outcomes = await Promise.allSettled([
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id }),
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id }),
    ])

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled')
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(DataSourceRefreshInProgressError)

    // Exactly one generation of rows survives — never duplicated, never
    // emptied by the loser interfering with the winner's insert/delete.
    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Producto Concurrente')

    // The claim is released after the winner finishes — a subsequent
    // request is never left blocked by this pair.
    expect(table('ai_data_sources').find((r) => r.id === source.id)?.refresh_started_at).toBeNull()
  })

  it('concurrent refreshes of TWO DIFFERENT sources never block each other', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    const sourceA = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'A', url: 'https://example.com/a.csv', usage: 'catalog',
    })
    const sourceB = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'B', url: 'https://example.com/b.csv', usage: 'catalog',
    })

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto', '111', '1']]))
    const [resultA, resultB] = await Promise.all([
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: sourceA.id }),
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: sourceB.id }),
    ])
    expect(resultA.source.id).toBe(sourceA.id)
    expect(resultB.source.id).toBe(sourceB.id)
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === sourceA.id)).toHaveLength(1)
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === sourceB.id)).toHaveLength(1)
  })

  it('account isolation holds under concurrency: two different accounts refreshing their own sources at the same time never cross-contaminate', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    const sourceAcct1 = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'S1', url: 'https://example.com/s1.csv', usage: 'catalog',
    })
    const sourceAcct2 = await createDataSourceFromUrl(db, {
      accountId: 'acct-2', userId: 'user-2', sourceType: 'remote_csv',
      displayName: 'S2', url: 'https://example.com/s2.csv', usage: 'catalog',
    })

    await Promise.all([
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: sourceAcct1.id }),
      refreshDataSource(db, { accountId: 'acct-2', userId: 'user-2', id: sourceAcct2.id }),
    ])
    expect(table('ai_catalog_products').find((r) => r.data_source_id === sourceAcct1.id)?.account_id).toBe('acct-1')
    expect(table('ai_catalog_products').find((r) => r.data_source_id === sourceAcct2.id)?.account_id).toBe('acct-2')
  })

  it('a failed refresh still releases the lock — the very next attempt is not blocked', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table, failNextUpsertOn } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'Source', url: 'https://example.com/products.csv', usage: 'catalog',
    })

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto Nuevo', '999', '1']]))
    failNextUpsertOn('ai_catalog_products')
    await expect(
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id }),
    ).rejects.toBeTruthy()
    expect(table('ai_data_sources').find((r) => r.id === source.id)?.refresh_started_at).toBeNull()

    // Retry immediately after the failure — must succeed, never rejected
    // as "already in progress" just because the previous attempt failed.
    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto Reintentado', '444', '2']]))
    const result = await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })
    expect(result.source.status).toBe('active')
    expect(table('ai_catalog_products').find((r) => r.data_source_id === source.id)?.name).toBe('Producto Reintentado')
  })

  it('a stale claim (e.g. a crashed/killed serverless invocation that never reached its finally) does not deadlock future refreshes', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'Source', url: 'https://example.com/products.csv', usage: 'catalog',
    })

    // Simulate an abandoned claim well past the staleness window —
    // never released, but old enough that a new refresh must recover.
    const row = table('ai_data_sources').find((r) => r.id === source.id)!
    row.refresh_started_at = new Date(Date.now() - 10 * 60_000).toISOString() // 10 minutes ago

    stubCsvFetch(csv([['Nombre', 'Precio', 'Stock'], ['Producto Recuperado', '321', '1']]))
    const result = await refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })
    expect(result.source.status).toBe('active')
    expect(table('ai_catalog_products').find((r) => r.data_source_id === source.id)?.name).toBe('Producto Recuperado')
  })

  it('a LIVE (non-stale) claim rejects a second refresh with a clear, distinguishable error — never a generic failure, never partial state', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'Source', url: 'https://example.com/products.csv', usage: 'catalog',
    })
    const row = table('ai_data_sources').find((r) => r.id === source.id)!
    row.refresh_started_at = new Date().toISOString() // claimed just now — still live

    await expect(
      refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id }),
    ).rejects.toBeInstanceOf(DataSourceRefreshInProgressError)
    // Left exactly as it was — no partial/error state written.
    expect(table('ai_catalog_products').filter((r) => r.data_source_id === source.id)).toHaveLength(1)
  })

  it('a real database error on the claim itself (e.g. a pending migration not yet applied) surfaces as a diagnosable DataSourceError, never a bare unhandled error indistinguishable from "already in progress"', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db, failNextUpdateOn } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1', userId: 'user-1', sourceType: 'remote_csv',
      displayName: 'Source', url: 'https://example.com/products.csv', usage: 'catalog',
    })

    failNextUpdateOn('ai_data_sources')
    const attempt = refreshDataSource(db, { accountId: 'acct-1', userId: 'user-1', id: source.id })
    await expect(attempt).rejects.toBeInstanceOf(DataSourceError)
    await expect(attempt).rejects.not.toBeInstanceOf(DataSourceRefreshInProgressError)
    await expect(attempt).rejects.toThrow(/Could not claim this refresh/)
  })
})

// ============================================================
// Bug #4 fix — duplicate SKU within one source used to collide on the
// same `source_product_id` (no dedup, no DB constraint), breaking
// getProduct/getAvailability/getProductMedia's by-id lookup for BOTH
// rows even though search_catalog kept showing them. Fixed in
// toCatalogProductRows(): the first row keeps using its SKU as-is: a
// LATER row whose SKU repeats one already used in this sync falls back
// to its own (always-unique) rowIndex-based id instead.
// ============================================================
describe('createDataSourceFromUrl / refreshDataSource — Bug #4 fix: duplicate SKU', () => {
  it('two rows sharing the same SKU end up with DISTINCT source_product_id — neither dropped, neither merged', async () => {
    stubCsvFetch(
      csv([
        ['SKU', 'Nombre', 'Precio'],
        ['DUP1', 'Producto Negro', '100'],
        ['DUP1', 'Producto Blanco', '110'], // same SKU as row above — data-entry mistake
      ]),
    )
    const { db, table } = fakeDb()

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Dup SKU source',
      url: 'https://example.com/dup.csv',
      usage: 'catalog',
    })

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(2) // both rows persisted — neither dropped
    const ids = rows.map((r) => r.source_product_id)
    expect(new Set(ids).size).toBe(2) // distinct ids — this is the actual fix
    // sku itself is untouched — still shows the real, duplicated value
    // on both rows (it's a display/lookup field, not the id).
    expect(rows.every((r) => r.sku === 'DUP1')).toBe(true)
    // The first row (by parse order) keeps the SKU verbatim as its id —
    // unchanged from before this fix.
    const first = rows.find((r) => r.name === 'Producto Negro')!
    const second = rows.find((r) => r.name === 'Producto Blanco')!
    expect(first.source_product_id).toBe('DUP1')
    expect(second.source_product_id).not.toBe('DUP1')
  })

  it('a source with NO duplicate SKUs is byte-identical to before this fix', async () => {
    stubCsvFetch(PRODUCTS_CSV) // single row, real SKU-less data — unaffected by the fix either way
    const { db, table } = fakeDb()

    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Normal source',
      url: 'https://example.com/normal.csv',
      usage: 'catalog',
    })

    const rows = table('ai_catalog_products').filter((r) => r.data_source_id === source.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].source_product_id).toBe('row-0') // unchanged fallback for a row with no SKU column at all
  })
})

// ============================================================
// Column selection survives a refresh (AI Sales Agent audit — column
// -selection pass, point 17): "no debe perder automáticamente la
// selección de columnas... si una columna ya no existe, mostrar una
// advertencia, no romper la fuente."
// ============================================================
describe('refreshDataSource — column selection (point 17)', () => {
  it('preserves selected_columns across a refresh and keeps filtering by it', async () => {
    stubCsvFetch(PRODUCTS_CSV) // Nombre, Precio, Stock
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'PRUEBA',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
      selectedColumns: ['Nombre', 'Precio'], // Stock excluded
    })
    expect(source.selected_columns).toEqual(['Nombre', 'Precio'])

    stubCsvFetch(PRODUCTS_CSV) // same headers, a real refresh
    const { source: refreshed, droppedColumns } = await refreshDataSource(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      id: source.id,
    })
    expect(refreshed.selected_columns).toEqual(['Nombre', 'Precio']) // NOT reset to null/all
    expect(droppedColumns).toEqual([]) // both selected columns still exist
  })

  it('warns (droppedColumns) but does not fail the refresh when a selected column disappears upstream', async () => {
    stubCsvFetch(PRODUCTS_CSV) // Nombre, Precio, Stock
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'PRUEBA',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
      selectedColumns: ['Nombre', 'Precio', 'Stock'],
    })

    // Upstream sheet drops the "Stock" column entirely on the next sync.
    stubCsvFetch(csv([['Nombre', 'Precio'], ['Samsung Galaxy S25', '34900']]))
    const { source: refreshed, droppedColumns } = await refreshDataSource(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      id: source.id,
    })

    expect(droppedColumns).toEqual(['Stock']) // surfaced as a warning...
    expect(refreshed.selected_columns).toEqual(['Nombre', 'Precio', 'Stock']) // ...but the selection itself is untouched
    expect(refreshed.status).toBe('active') // never breaks the source
    expect(refreshed.last_error).toBeNull() // this is a warning, not a sync failure
    // The product row honestly has NO stock data (null) rather than
    // silently keeping the stale number from before the column
    // vanished, or fabricating a new one — "no lo sé" is correct here,
    // a wrong-but-present number would be worse (AI Sales Agent audit,
    // Part 5: "evitar generar datos incorrectos silenciosamente").
    expect(table('ai_catalog_products')[0]).toMatchObject({
      name: 'Samsung Galaxy S25',
      price: 34900,
      available_quantity: null,
    })
  })

  // AI Sales Agent audit (final pass), Part 6 — a column that shows up
  // for the first time on refresh must be VISIBLE (detected, usable if
  // the user later re-configures) but never silently opted into
  // automatically. Otherwise a business's newly-added, possibly
  // sensitive column ("costo_interno") would leak into the agent's
  // catalog the moment someone edits the sheet, with no one having
  // chosen that.
  it('a brand-new column appearing on refresh is detected but never auto-added to selected_columns', async () => {
    stubCsvFetch(csv([['Nombre', 'Precio', 'Cantidad'], ['Producto X', '1500', '10']]))
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'PRUEBA',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
      selectedColumns: ['Nombre', 'Precio', 'Cantidad'],
    })

    // Upstream sheet gains a new "Marca" column.
    stubCsvFetch(csv([['Nombre', 'Precio', 'Cantidad', 'Marca'], ['Producto X', '1500', '10', 'MarcaX']]))
    const { source: refreshed, droppedColumns } = await refreshDataSource(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      id: source.id,
    })

    expect(droppedColumns).toEqual([]) // nothing PREVIOUSLY selected went missing
    expect(refreshed.selected_columns).toEqual(['Nombre', 'Precio', 'Cantidad']) // "Marca" NOT auto-added
    // The new column is genuinely detected as metadata (column_mapping
    // records that a "brand" column named "marca" exists — structural
    // info, not customer-facing data) — it's only not USED for
    // anything yet, not invisible to the system. The "Ver datos"
    // dialog itself still won't show it (it filters column_mapping
    // entries down to ones ALSO in selected_columns), and it never
    // reaches the flattened KB text / ai_catalog_products either,
    // since neither is populated for a column outside the selection.
    expect(refreshed.column_mapping?.brand).toBe('marca')
    // ...but the actual DATA never landed anywhere selection-gated.
    expect(refreshed.preview_sample?.columns).not.toContain('Marca')
    expect(refreshed.preview_sample?.sample.some((r) => 'Marca' in r)).toBe(false)
  })

  it('a source with no explicit selection (null) stays null across a refresh — still "use everything"', async () => {
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
    expect(source.selected_columns).toBeNull()

    stubCsvFetch(PRODUCTS_CSV)
    const { source: refreshed, droppedColumns } = await refreshDataSource(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      id: source.id,
    })
    expect(refreshed.selected_columns).toBeNull()
    expect(droppedColumns).toEqual([])
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

    const { source: refreshed } = await refreshDataSource(db, { accountId: 'acct-dop', userId: 'user-1', id: source.id })
    expect(refreshed.currency).toBe('DOP')
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

  it('usage=catalog: previews the RAW selected columns (not the structured ai_catalog_products schema)', async () => {
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
    expect(result!.preview.kind).toBe('sheet')
    expect(result!.preview.rows).toHaveLength(1)
    // Raw header keys (from PRODUCTS_CSV: Nombre/Precio/Stock), never
    // the structured product schema (name/price/currency/...) — this
    // is what column-selection filters, so it must be the raw view.
    expect(result!.preview.rows[0]).toMatchObject({ Nombre: 'Samsung Galaxy S25' })
    expect(result!.preview.columns).toEqual(['Nombre', 'Precio', 'Stock'])
  })

  it('usage=both: same uniform raw preview as catalog/knowledge — one code path for every usage', async () => {
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
    expect(result!.preview.kind).toBe('sheet')
    expect(result!.preview.rows).toHaveLength(1)
  })

  it('usage=knowledge: previews the same parse-time sample snapshot', async () => {
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
    expect(result!.preview.kind).toBe('sheet')
    expect(result!.preview.rows).toHaveLength(1)
    expect(result!.preview.rows[0]).toMatchObject({ Nombre: 'Samsung Galaxy S25' })
    expect(result!.preview.columns).toEqual(['Nombre', 'Precio', 'Stock'])
  })

  it('only the SELECTED columns appear in the preview — never a column the user excluded', async () => {
    stubCsvFetch(PRODUCTS_CSV) // headers: Nombre, Precio, Stock
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'PRUEBA',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
      selectedColumns: ['Nombre', 'Precio'], // Stock deliberately excluded
    })

    const result = await getDataSourcePreview(db, 'acct-1', source.id)
    expect(result!.preview.columns).toEqual(['Nombre', 'Precio'])
    expect(result!.preview.rows[0]).toEqual({ Nombre: 'Samsung Galaxy S25', Precio: '34900' })
    expect(result!.preview.rows[0]).not.toHaveProperty('Stock')
    // And the persisted selection itself is readable back off the row.
    expect(source.selected_columns).toEqual(['Nombre', 'Precio'])
  })

  // AI Sales Agent audit (final pass), Part 2/3/14 — the exact bug
  // found on re-audit: the frontend used to only send selected_columns
  // when the user excluded something, so leaving every box checked
  // (the default, most common path) silently persisted null instead
  // of the explicit list the user had just configured. Fixed in
  // data-sources-settings.tsx; this asserts the SERVICE side already
  // does the right thing once given an explicit "select everything"
  // array — a real array, never coerced to null just because it
  // happens to equal "all".
  it('a NEW source that explicitly selects every detected column still persists selected_columns as an array, not null', async () => {
    stubCsvFetch(PRODUCTS_CSV) // headers: Nombre, Precio, Stock
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'PRUEBA',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
      selectedColumns: ['Nombre', 'Precio', 'Stock'], // every real column, explicitly
    })
    expect(source.selected_columns).toEqual(['Nombre', 'Precio', 'Stock'])
    expect(source.selected_columns).not.toBeNull()
  })

  it('a source created with NO selection step at all (selectedColumns never passed) is the only case that persists null', async () => {
    stubCsvFetch(PRODUCTS_CSV)
    const { db } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'PRUEBA',
      url: 'https://example.com/products.csv',
      usage: 'catalog',
      // selectedColumns omitted entirely — legacy/compatibility path.
    })
    expect(source.selected_columns).toBeNull()
  })

  it('a row that produced zero usable ai_catalog_products still shows a real raw preview — "Ver datos" is not gated on catalog success', async () => {
    // The one data row has no name column value (only a price), so
    // buildProductRows drops it as "nothing searchable" for the
    // catalog — but the raw sheet preview is independent of that and
    // must still show exactly what the sheet actually contains.
    stubCsvFetch(csv([['Nombre', 'Precio'], ['', '100']]))
    const { db, table } = fakeDb()
    const source = await createDataSourceFromUrl(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      sourceType: 'remote_csv',
      displayName: 'Empty-ish',
      url: 'https://example.com/empty.csv',
      usage: 'catalog',
    })
    expect(table('ai_catalog_products')).toHaveLength(0) // no usable products

    const result = await getDataSourcePreview(db, 'acct-1', source.id)
    expect(result!.preview.kind).toBe('sheet')
    expect(result!.preview.rows).toEqual([{ Nombre: '', Precio: '100' }])
  })

  it('reports kind=empty for a source that predates migration 046 (preview_sample never populated)', async () => {
    const { db, table } = fakeDb()
    // Simulate a legacy row inserted before preview_sample existed —
    // every other column present, preview_sample genuinely absent.
    table('ai_data_sources').push({
      id: 'legacy-1',
      account_id: 'acct-1',
      source_type: 'google_sheets',
      display_name: 'Old source',
      usage: 'catalog',
      status: 'active',
      preview_sample: null,
      selected_columns: null,
    })

    const result = await getDataSourcePreview(db, 'acct-1', 'legacy-1')
    expect(result!.preview).toEqual({ kind: 'empty', columns: [], rows: [] })
  })
})
