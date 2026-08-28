// ============================================================
// Data Sources service — CRUD + fetch/parse/ingest for the
// google_sheets / remote_csv / uploaded_csv sources introduced by
// migration 044.
//
// Reuses, unmodified:
//   - src/lib/ai/inventory-parser.ts (parseSheetCsv/parseInventoryFile)
//     for CSV/Excel parsing + column detection — extended (not
//     replaced) in this same change to also emit structured
//     `products` rows.
//   - src/lib/ai/knowledge.ts::ingestDocument for the `knowledge`/`both`
//     side (chunk + optional embed), so retrieveKnowledge() picks up a
//     data source's content with ZERO changes to that module.
//   - src/lib/ai/config.ts::loadEmbeddingsKey, same as the legacy
//     /api/ai/knowledge/{upload,sheet} routes.
//
// A refresh REPLACES only this data source's own rows (its
// ai_knowledge_documents row via data_source_id, its
// ai_catalog_products rows via data_source_id) — never the legacy
// singleton type='inventory' document, never another data source's
// rows, never manually-pasted KB entries.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { ingestDocument } from '../knowledge'
import { loadEmbeddingsKey } from '../config'
import {
  parseInventoryFile,
  parseSheetCsv,
  InventoryError,
  type CatalogProductRow,
  type ParsedInventory,
} from '../inventory-parser'
import type { DataSourceMutableFields, DataSourceRow, DataSourceType, DataSourceUsage } from './types'

const SELECT_COLUMNS =
  'id, account_id, source_type, display_name, source_url, source_filename, usage, status, priority, is_primary, fallback_policy, currency, column_mapping, row_count, knowledge_document_id, last_synced_at, last_error, created_at, updated_at, preview_sample, selected_columns'

export class DataSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataSourceError'
  }
}

/**
 * The account's configured display currency (accounts.default_currency),
 * falling back to 'USD' only when the account row has none set. This is
 * the SAME source of truth the legacy /api/ai/knowledge/{upload,sheet}
 * routes already used — callers here must use it too instead of
 * hardcoding 'USD', or a DOP (or any non-USD) account gets every new
 * catalog product mislabeled (AI_Catalog_Fix_Kit FASE 12).
 */
export async function accountDefaultCurrency(db: SupabaseClient, accountId: string): Promise<string> {
  const { data } = await db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle()
  return (data as { default_currency?: string } | null)?.default_currency ?? 'USD'
}

export async function listDataSources(db: SupabaseClient, accountId: string): Promise<DataSourceRow[]> {
  const { data, error } = await db
    .from('ai_data_sources')
    .select(SELECT_COLUMNS)
    .eq('account_id', accountId)
    .order('is_primary', { ascending: false })
    .order('priority', { ascending: true })
  if (error) throw error
  return (data ?? []) as DataSourceRow[]
}

/** The account's legacy single-inventory data source, if one has been
 *  created (via the /api/ai/knowledge/{upload,sheet} compatibility
 *  routes) — see migration 045's partial unique index, which guarantees
 *  at most one such row exists per account. */
export async function findLegacyDefaultDataSource(
  db: SupabaseClient,
  accountId: string,
): Promise<DataSourceRow | null> {
  const { data, error } = await db
    .from('ai_data_sources')
    .select(SELECT_COLUMNS)
    .eq('account_id', accountId)
    .eq('is_legacy_default', true)
    .maybeSingle()
  if (error) {
    // Tolerate migration 045 not being applied yet — same "degrade,
    // don't break" discipline as elsewhere in this feature.
    console.warn('[data-sources] legacy-default lookup failed (migration 045 applied?):', error.message)
    return null
  }
  return (data as DataSourceRow) ?? null
}

export async function getDataSource(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<DataSourceRow | null> {
  const { data, error } = await db
    .from('ai_data_sources')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return (data as DataSourceRow) ?? null
}

/** One row of a data source's "Ver datos" preview table, keyed by the
 *  file's own raw header names — never a fixed/structured schema, so
 *  the UI can never show a column ("Talla", "Color", ...) that simply
 *  doesn't exist in that particular source. */
export type DataSourcePreviewRow = Record<string, string>

export interface DataSourcePreview {
  /** 'sheet': the parse-time snapshot (preview_sample) — same for
   *  every usage (catalog/knowledge/both), always the RAW selected
   *  columns, never the structured ai_catalog_products schema. Kept
   *  in sync with the catalog rows because both are produced by the
   *  exact same parse pass (inventory-parser.ts), so this can't drift
   *  from what search_catalog/get_product actually return.
   *  'empty': no snapshot yet (a source created before migration 046
   *  that hasn't been refreshed since, or one whose last sync failed
   *  before producing any rows). */
  kind: 'sheet' | 'empty'
  /** The columns actually kept for this source — source.selected_columns
   *  when the user made an explicit choice, otherwise every column the
   *  parser detected (backward-compatible with a source that predates
   *  the column-selection step). Always equals `Object.keys(rows[0])`
   *  when rows is non-empty. */
  columns: string[]
  rows: DataSourcePreviewRow[]
}

/** Real "Ver datos" preview for one data source — the columns it
 *  detected/kept, its metadata, and a sample of the actual persisted
 *  rows. Never re-fetches/re-parses the source; reads back what the
 *  last create/refresh already wrote (preview_sample), same
 *  discipline as everywhere else in this pipeline — a preview must
 *  reflect what's actually stored, not what a fresh re-fetch might
 *  currently contain. */
export async function getDataSourcePreview(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<{ source: DataSourceRow; preview: DataSourcePreview } | null> {
  const source = await getDataSource(db, accountId, id)
  if (!source) return null

  if (source.preview_sample && source.preview_sample.sample.length > 0) {
    return {
      source,
      preview: { kind: 'sheet', columns: source.preview_sample.columns, rows: source.preview_sample.sample },
    }
  }
  return { source, preview: { kind: 'empty', columns: [], rows: [] } }
}

export async function updateDataSourceMeta(
  db: SupabaseClient,
  accountId: string,
  id: string,
  patch: DataSourceMutableFields,
): Promise<DataSourceRow> {
  if (patch.isPrimary) {
    await db.from('ai_data_sources').update({ is_primary: false }).eq('account_id', accountId)
  }
  const update: Record<string, unknown> = {}
  if (patch.displayName !== undefined) update.display_name = patch.displayName
  if (patch.usage !== undefined) update.usage = patch.usage
  if (patch.status !== undefined) update.status = patch.status
  if (patch.priority !== undefined) update.priority = patch.priority
  if (patch.isPrimary !== undefined) update.is_primary = patch.isPrimary
  if (patch.fallbackPolicy !== undefined) update.fallback_policy = patch.fallbackPolicy
  if (patch.currency !== undefined) update.currency = patch.currency

  const { data, error } = await db
    .from('ai_data_sources')
    .update(update)
    .eq('id', id)
    .eq('account_id', accountId)
    .select(SELECT_COLUMNS)
    .single()
  if (error) throw error
  return data as DataSourceRow
}

export async function deleteDataSource(db: SupabaseClient, accountId: string, id: string): Promise<void> {
  // ai_catalog_products rows cascade via FK (ON DELETE CASCADE). The
  // linked ai_knowledge_documents row cascades too (migration 044 adds
  // data_source_id with ON DELETE CASCADE), which in turn cascades its
  // chunks — so retrieveKnowledge() stops seeing this source's content
  // in the same transaction as the delete.
  const { error } = await db.from('ai_data_sources').delete().eq('id', id).eq('account_id', accountId)
  if (error) throw error
}

interface IngestOptions {
  accountId: string
  userId: string
  displayName: string
  sourceType: DataSourceType
  sourceUrl: string | null
  sourceFilename: string | null
  usage: DataSourceUsage
  priority: number
  isPrimary: boolean
  fallbackPolicy: DataSourceRow['fallback_policy']
  currency: string
  selectedColumns?: string[]
  /** Existing row id when refreshing; omitted when creating. */
  existingId?: string
  /** Marks this as THE account's legacy single-inventory source (see
   *  migration 045's partial unique index) — set only by the
   *  /api/ai/knowledge/{upload,sheet} compatibility routes. */
  isLegacyDefault?: boolean
}

/** Parse + persist one data source (create or refresh). Shared by the
 *  google_sheets/remote_csv/uploaded_csv creation paths and by the
 *  refresh route — the only difference between them is how `parsed` is
 *  obtained (fetch+parseSheetCsv vs parseInventoryFile on an uploaded
 *  buffer), which callers do before calling this. */
async function persistDataSource(
  db: SupabaseClient,
  opts: IngestOptions,
  parsed: ParsedInventory,
): Promise<DataSourceRow> {
  const { accountId, userId, usage } = opts

  const baseRow = {
    account_id: accountId,
    created_by: userId,
    source_type: opts.sourceType,
    display_name: opts.displayName,
    source_url: opts.sourceUrl,
    source_filename: opts.sourceFilename,
    usage,
    priority: opts.priority,
    is_primary: opts.isPrimary,
    fallback_policy: opts.fallbackPolicy,
    currency: opts.currency,
    column_mapping: parsed.metadata.detected,
    row_count: parsed.metadata.rows,
    status: 'active' as const,
    last_error: null as string | null,
    last_synced_at: new Date().toISOString(),
    // See migration 046 — the uniform source getDataSourcePreview()
    // reads back for "Ver datos", for every usage. previewColumns (not
    // the always-complete `columns`) so this stays in lockstep with
    // what selected_columns actually kept — never shows a column the
    // user excluded.
    preview_sample: { sample: parsed.preview.sample, columns: parsed.metadata.previewColumns },
    // See migration 048. null = no explicit selection was ever made
    // (every column detected is in use) — the exact prior behavior,
    // preserved for any source created before this feature existed.
    selected_columns: opts.selectedColumns ?? null,
    ...(opts.isLegacyDefault !== undefined ? { is_legacy_default: opts.isLegacyDefault } : {}),
  }

  if (opts.isPrimary) {
    await db.from('ai_data_sources').update({ is_primary: false }).eq('account_id', accountId)
  }

  let source: DataSourceRow
  if (opts.existingId) {
    const { data, error } = await db
      .from('ai_data_sources')
      .update(baseRow)
      .eq('id', opts.existingId)
      .eq('account_id', accountId)
      .select(SELECT_COLUMNS)
      .single()
    if (error) throw error
    source = data as DataSourceRow
  } else {
    const { data, error } = await db.from('ai_data_sources').insert(baseRow).select(SELECT_COLUMNS).single()
    if (error) throw error
    source = data as DataSourceRow
  }

  // ---- knowledge side: reuse ai_knowledge_documents/chunks verbatim.
  if (usage === 'knowledge' || usage === 'both') {
    // Replace only THIS source's document (not the legacy singleton
    // type='inventory' doc, not another source's doc).
    await db.from('ai_knowledge_documents').delete().eq('data_source_id', source.id)

    const { data: doc, error: docErr } = await db
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        created_by: userId,
        type: 'data_source',
        data_source_id: source.id,
        title: `Fuente de datos — ${opts.displayName}`,
        content: parsed.content,
        metadata: parsed.metadata,
      })
      .select('id')
      .single()
    if (docErr || !doc) throw docErr ?? new DataSourceError('Failed to save data source document.')

    const { key: embeddingsApiKey } = await loadEmbeddingsKey(db, accountId)
    try {
      await ingestDocument(db, accountId, { embeddingsApiKey }, doc.id, parsed.content)
    } catch (err) {
      // Non-fatal — lexical search still works over the un-embedded
      // chunks `ingestDocument` already wrote before the embed step.
      console.error('[data-sources] embedding failed (lexical search still active):', err)
    }

    await db.from('ai_data_sources').update({ knowledge_document_id: doc.id }).eq('id', source.id)
    source.knowledge_document_id = doc.id
  } else if (source.knowledge_document_id) {
    // Usage changed away from knowledge/both on a refresh — drop the
    // now-orphaned document rather than leaving stale text reachable by
    // retrieveKnowledge().
    await db.from('ai_knowledge_documents').delete().eq('id', source.knowledge_document_id)
    await db.from('ai_data_sources').update({ knowledge_document_id: null }).eq('id', source.id)
    source.knowledge_document_id = null
  }

  // ---- catalog side: structured rows, NEVER written to the KB.
  if (usage === 'catalog' || usage === 'both') {
    await db.from('ai_catalog_products').delete().eq('data_source_id', source.id)
    const rows = toCatalogProductRows(parsed.products, source.id, accountId, opts.currency)
    if (rows.length > 0) {
      const { error: insErr } = await db.from('ai_catalog_products').insert(rows)
      if (insErr) throw insErr
    }
  } else {
    await db.from('ai_catalog_products').delete().eq('data_source_id', source.id)
  }

  return source
}

function toCatalogProductRows(
  products: CatalogProductRow[],
  dataSourceId: string,
  accountId: string,
  currency: string,
) {
  return products.map((p) => ({
    account_id: accountId,
    data_source_id: dataSourceId,
    source_product_id: p.sku ?? `row-${p.rowIndex}`,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    model: p.model,
    description: p.description,
    color: p.color,
    variant_label: p.variantLabel,
    capacity: p.capacity,
    size: p.size,
    price: p.price,
    currency,
    available: p.availableQuantity === null ? true : p.availableQuantity > 0,
    available_quantity: p.availableQuantity,
    primary_image_url: p.imageUrl,
    images: p.imageUrl ? [{ url: p.imageUrl }] : [],
  }))
}

function assertGoogleSheetsUrl(url: string) {
  if (!url.includes('docs.google.com/spreadsheets')) {
    throw new DataSourceError(
      'Not a valid Google Sheets URL. Publish your sheet as CSV and paste the export URL.',
    )
  }
}

async function fetchCsv(url: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new DataSourceError('Could not reach the URL. Check the link and try again.')
  }
  if (!res.ok) {
    throw new DataSourceError(`Failed to fetch: HTTP ${res.status}.`)
  }
  const text = await res.text()
  if (/^<!DOCTYPE html/i.test(text.trim()) || /^<html/i.test(text.trim())) {
    throw new DataSourceError(
      'The URL returned an HTML page, not CSV. For Google Sheets: File → Share → Publish to the web → "Comma-separated values (.csv)".',
    )
  }
  return text
}

export interface CreateFromUrlInput {
  accountId: string
  userId: string
  sourceType: 'google_sheets' | 'remote_csv'
  displayName: string
  url: string
  usage: DataSourceUsage
  priority?: number
  isPrimary?: boolean
  fallbackPolicy?: DataSourceRow['fallback_policy']
  currency?: string
  selectedColumns?: string[]
  /** Upsert an existing row instead of always creating a new one — used
   *  by the legacy /api/ai/knowledge/sheet compatibility route so
   *  re-uploading keeps replacing THE ONE inventory source, matching
   *  the pre-unification "there is only one inventory" behavior. */
  existingId?: string
  isLegacyDefault?: boolean
}

export async function createDataSourceFromUrl(
  db: SupabaseClient,
  input: CreateFromUrlInput,
): Promise<DataSourceRow> {
  if (input.sourceType === 'google_sheets') assertGoogleSheetsUrl(input.url)
  // Resolve ONCE, from the same source of truth the API routes already
  // use — never a bare 'USD' fallback here. This is the second half of
  // the currency root-cause fix: every caller (today, only the API
  // routes) already resolves and passes `currency` explicitly, but a
  // hardcoded 'USD' fallback sitting here too meant a future caller
  // that forgot to pass it would silently reintroduce the exact bug.
  // Resolved before parsing so the flattened KB text (knowledge/both
  // usage) also gets the right currency, not just the structured rows.
  const currency = input.currency ?? (await accountDefaultCurrency(db, input.accountId))
  const csvText = await fetchCsv(input.url)
  let parsed: ParsedInventory
  try {
    parsed = parseSheetCsv(csvText, input.url, input.selectedColumns, currency)
  } catch (err) {
    throw new DataSourceError(err instanceof InventoryError ? err.message : 'Failed to parse data.')
  }
  return persistDataSource(
    db,
    {
      accountId: input.accountId,
      userId: input.userId,
      displayName: input.displayName,
      sourceType: input.sourceType,
      sourceUrl: input.url,
      sourceFilename: null,
      usage: input.usage,
      priority: input.priority ?? 100,
      isPrimary: input.isPrimary ?? false,
      fallbackPolicy: input.fallbackPolicy ?? 'fallback_on_not_found',
      currency,
      selectedColumns: input.selectedColumns,
      existingId: input.existingId,
      isLegacyDefault: input.isLegacyDefault,
    },
    parsed,
  )
}

export interface CreateFromFileInput {
  accountId: string
  userId: string
  displayName: string
  filename: string
  buffer: ArrayBuffer
  usage: DataSourceUsage
  priority?: number
  isPrimary?: boolean
  fallbackPolicy?: DataSourceRow['fallback_policy']
  currency?: string
  selectedColumns?: string[]
  existingId?: string
  isLegacyDefault?: boolean
}

export async function createDataSourceFromFile(
  db: SupabaseClient,
  input: CreateFromFileInput,
): Promise<DataSourceRow> {
  // See the matching comment in createDataSourceFromUrl — resolved once,
  // from accountDefaultCurrency, never a bare 'USD' fallback.
  const currency = input.currency ?? (await accountDefaultCurrency(db, input.accountId))
  let parsed: ParsedInventory
  try {
    parsed = parseInventoryFile(input.buffer, input.filename, input.selectedColumns, currency)
  } catch (err) {
    throw new DataSourceError(err instanceof InventoryError ? err.message : 'Failed to parse file.')
  }
  return persistDataSource(
    db,
    {
      accountId: input.accountId,
      userId: input.userId,
      displayName: input.displayName,
      sourceType: 'uploaded_csv',
      sourceUrl: null,
      sourceFilename: input.filename,
      usage: input.usage,
      priority: input.priority ?? 100,
      isPrimary: input.isPrimary ?? false,
      fallbackPolicy: input.fallbackPolicy ?? 'fallback_on_not_found',
      currency,
      selectedColumns: input.selectedColumns,
      existingId: input.existingId,
      isLegacyDefault: input.isLegacyDefault,
    },
    parsed,
  )
}

export interface RefreshInput {
  accountId: string
  userId: string
  id: string
  /** Required when the existing row is `uploaded_csv` — there is no
   *  stored URL to refetch, so refreshing means re-uploading. */
  file?: { filename: string; buffer: ArrayBuffer }
}

export interface RefreshResult {
  source: DataSourceRow
  /** Previously-selected columns (existing.selected_columns) that no
   *  longer appear in the freshly-fetched sheet/file — e.g. someone
   *  renamed or removed a column upstream. Never auto-pruned from
   *  `selected_columns` itself (point 17: the selection is conserved
   *  verbatim so the column re-activates on its own if it comes back);
   *  this is purely an informational warning for the caller to show,
   *  the refresh still succeeds and the source stays active. */
  droppedColumns: string[]
}

export async function refreshDataSource(db: SupabaseClient, input: RefreshInput): Promise<RefreshResult> {
  const existing = await getDataSource(db, input.accountId, input.id)
  if (!existing) throw new DataSourceError('Data source not found.')

  // Re-resolve the account's CURRENT currency on every refresh rather
  // than reusing `existing.currency` verbatim. Root-cause fix: a row
  // created before the account-currency wiring existed (or by any other
  // bug that left the wrong code stored) would otherwise PERPETUATE that
  // wrong currency forever, since every subsequent refresh just copied
  // whatever was already on the row — "5. Una futura sincronización del
  // mismo Google Sheet no vuelva a convertir DOP en USD" only holds if
  // refresh actively re-checks the source of truth, not just the cache
  // of its own last write. There is currently no UI to override a data
  // source's currency independently of the account's, so this is safe;
  // if that ever changes, this call site is the one to revisit.
  const currency = await accountDefaultCurrency(db, input.accountId)

  try {
    // Preserve the existing column selection across a refresh (point
    // 17 — "no debe perder automáticamente la selección de columnas").
    // Passed straight to the parser exactly like a create call would;
    // a selected column that no longer exists in the fresh data
    // simply won't match anything in buildInventory's own filter
    // (silently excluded from this sync, same as if it had never been
    // selected) — surfaced below as `droppedColumns`, not an error.
    const selectedColumns = existing.selected_columns ?? undefined

    let parsed: ParsedInventory
    if (existing.source_type === 'uploaded_csv') {
      if (!input.file) {
        throw new DataSourceError('Re-upload the file to refresh an uploaded CSV source.')
      }
      parsed = parseInventoryFile(input.file.buffer, input.file.filename, selectedColumns, currency)
    } else {
      if (!existing.source_url) throw new DataSourceError('This data source has no URL to refresh.')
      if (existing.source_type === 'google_sheets') assertGoogleSheetsUrl(existing.source_url)
      const csvText = await fetchCsv(existing.source_url)
      parsed = parseSheetCsv(csvText, existing.source_url, selectedColumns, currency)
    }

    const source = await persistDataSource(
      db,
      {
        accountId: input.accountId,
        userId: input.userId,
        displayName: existing.display_name,
        sourceType: existing.source_type,
        sourceUrl: existing.source_url,
        sourceFilename: input.file?.filename ?? existing.source_filename,
        usage: existing.usage,
        priority: existing.priority,
        isPrimary: existing.is_primary,
        fallbackPolicy: existing.fallback_policy,
        currency,
        selectedColumns,
        existingId: existing.id,
      },
      parsed,
    )

    const survivingLower = new Set(parsed.metadata.previewColumns.map((c) => c.toLowerCase()))
    const droppedColumns = (existing.selected_columns ?? []).filter((c) => !survivingLower.has(c.toLowerCase()))

    return { source, droppedColumns }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed.'
    await db.from('ai_data_sources').update({ status: 'error', last_error: message }).eq('id', existing.id)
    throw err
  }
}
