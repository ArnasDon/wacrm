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
import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
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
 * Thrown when a data source id doesn't exist for the calling account —
 * either it was never created or it belongs to a different tenant.
 * Deliberately a DISTINCT class from `DataSourceError` (though it
 * extends it, so an existing `instanceof DataSourceError` check still
 * catches it) so a route can map "not found" to 404 without confusing
 * it with a 422 validation/parse failure — see the FASE 4 audit: before
 * this existed, a foreign/missing id surfaced as a raw 500 (PATCH,
 * because `updateDataSourceMeta` had already unconditionally cleared
 * every OTHER source's `is_primary` flag before discovering the target
 * row didn't exist) or a misleading 422 (refresh).
 */
export class DataSourceNotFoundError extends DataSourceError {
  constructor() {
    super('Data source not found.')
    this.name = 'DataSourceNotFoundError'
  }
}

// ============================================================
// SSRF protection (FASE 4 audit, Bug #1) — every server-side fetch this
// feature makes goes to a URL an account admin supplies (remote_csv /
// google_sheets). Without this, an admin could point the server at an
// internal/private address (loopback, RFC1918, link-local, a cloud
// metadata endpoint) and have it fetched and partially reflected back.
//
// KNOWN LIMITATION, stated plainly rather than silently glossed over:
// this validates the hostname's CURRENTLY resolved address(es)
// immediately before each fetch (including each redirect hop), but
// does not pin the TCP connection to the address it validated — an
// attacker controlling DNS with a sub-second TTL who flips the answer
// between this check and the fetch a moment later (classic DNS
// rebinding) is not fully closed by this alone. It does block every
// attack this feature needs to block today: a literal internal/loopback
// IP, "localhost", a cloud metadata address, and a redirect chain
// through any of those.
// ============================================================

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true // unparseable — fail closed
  const [a, b] = parts
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 10) return true // 10.0.0.0/8 RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 168) return true // 192.168.0.0/16 RFC1918
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (also covers 169.254.169.254 cloud metadata)
  if (a === 0) return true // 0.0.0.0/8 — "this network"/unspecified, a well-known loopback-equivalent bypass
  return false
}

/** Expands any valid IPv6 text form (with `::` compression and an
 *  optional embedded IPv4 tail like `::ffff:127.0.0.1`) to its 8 16-bit
 *  groups. Returns null for anything unparseable — callers must treat
 *  that as "reject", never "assume safe". */
function expandIpv6(address: string): number[] | null {
  let addr = address.trim()

  const ipv4Tail = addr.match(/(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (ipv4Tail) {
    const octets = ipv4Tail[1].split('.').map(Number)
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null
    const hex1 = (((octets[0] << 8) | octets[1]) >>> 0).toString(16)
    const hex2 = (((octets[2] << 8) | octets[3]) >>> 0).toString(16)
    addr = addr.slice(0, addr.length - ipv4Tail[1].length) + hex1 + ':' + hex2
  }

  const halves = addr.split('::')
  if (halves.length > 2) return null
  const toGroups = (s: string) => (s ? s.split(':') : [])
  const head = toGroups(halves[0])
  const tail = halves.length === 2 ? toGroups(halves[1]) : []

  let groupsHex: string[]
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 0) return null
    groupsHex = [...head, ...Array(missing).fill('0'), ...tail]
  } else {
    groupsHex = head
  }
  if (groupsHex.length !== 8) return null

  const groups = groupsHex.map((g) => (g === '' ? 0 : parseInt(g, 16)))
  if (groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null
  return groups
}

function isBlockedIpv6(address: string): boolean {
  const groups = expandIpv6(address)
  if (!groups) return true // unparseable — fail closed
  const [g0] = groups

  if (groups.every((g) => g === 0)) return true // :: (unspecified)
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1 loopback

  // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded IPv4 address
  // against the same IPv4 blocklist, so ::ffff:127.0.0.1 can't smuggle
  // a blocked address past an IPv6-only check.
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    const a = (groups[6] >> 8) & 0xff
    const b = groups[6] & 0xff
    const c = (groups[7] >> 8) & 0xff
    const d = groups[7] & 0xff
    return isBlockedIpv4(`${a}.${b}.${c}.${d}`)
  }

  if (g0 >= 0xfe80 && g0 <= 0xfebf) return true // fe80::/10 link-local
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true // fc00::/7 unique-local (private-equivalent)
  return false
}

function isBlockedAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isBlockedIpv4(address)
  if (version === 6) return isBlockedIpv6(address)
  return true // not a recognizable IP literal — fail closed, never assume safe
}

/**
 * Validates that `rawUrl` is safe for the SERVER to fetch: http(s) only,
 * not "localhost", and every address its hostname currently resolves to
 * (IPv4 and IPv6 alike) falls outside loopback/RFC1918/link-local/
 * unique-local ranges. Throws `DataSourceError` (never silently passes)
 * on anything unparseable, unresolvable, or blocked.
 */
async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new DataSourceError('Invalid URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DataSourceError('Only http:// and https:// URLs are allowed.')
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new DataSourceError('URLs pointing to localhost are not allowed.')
  }

  const addresses: string[] = []
  if (isIP(hostname)) {
    addresses.push(hostname)
  } else {
    try {
      const results = await dnsLookup(hostname, { all: true, verbatim: true })
      for (const r of results) addresses.push(r.address)
    } catch {
      throw new DataSourceError("Could not resolve the URL's host.")
    }
  }
  if (addresses.length === 0) {
    throw new DataSourceError("Could not resolve the URL's host.")
  }

  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new DataSourceError(
        'This URL points to a private or internal network address, which is not allowed.',
      )
    }
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
  // Verify the target row exists for THIS account BEFORE touching
  // anything else (FASE 4 audit, Bug #2). Previously the `is_primary`
  // clear below ran unconditionally first — a PATCH for a wrong or
  // foreign id would still wipe every real source's is_primary flag,
  // then fail to find the target row and throw, leaving the account
  // with no primary source at all even though the request never
  // succeeded. Never touches another tenant's row: this lookup is
  // scoped by the same `account_id` filter as everything else here.
  const existing = await db
    .from('ai_data_sources')
    .select('id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) throw new DataSourceNotFoundError()

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
  // Same existence check as updateDataSourceMeta, and for the same
  // reason routes want to tell "nothing to delete" (404) apart from a
  // real Supabase failure (500) — a bare DELETE with zero matching rows
  // is not an error to Postgrest, so without this check a foreign/
  // missing id would silently report success (FASE 4 audit).
  const existing = await db
    .from('ai_data_sources')
    .select('id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) throw new DataSourceNotFoundError()

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
  //
  // Bug #1 fix (refresh atomicity): this used to DELETE this source's
  // existing document FIRST, then INSERT the new one — two independent
  // Postgrest calls, no transaction. If the insert (or the ingest step
  // it depends on) failed after the delete had already committed, the
  // source's Knowledge Base content was gone with no rollback, even
  // though the refresh as a whole reported failure. Now: the new
  // document (and its chunks, via ingestDocument) is written FIRST;
  // only once that has fully succeeded — and `ai_data_sources` has
  // already been repointed at it — is the PREVIOUS document removed.
  // A failure at any point up to that repoint leaves the old document
  // (and the chunks depending on it via ON DELETE CASCADE) completely
  // untouched, so the account never loses Knowledge Base content it
  // already had because a refresh happened to fail midway.
  if (usage === 'knowledge' || usage === 'both') {
    const previousKnowledgeDocumentId = source.knowledge_document_id

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

    // Only now — the new document is live and `ai_data_sources` already
    // points at it — remove the PREVIOUS one (not the legacy singleton
    // type='inventory' doc, not another source's doc: `data_source_id`
    // scoping is preserved by targeting this exact prior id). Its own
    // chunks cascade-delete with it (ai_knowledge_chunks.document_id
    // is ON DELETE CASCADE — migration 030).
    if (previousKnowledgeDocumentId) {
      await db.from('ai_knowledge_documents').delete().eq('id', previousKnowledgeDocumentId)
    }
  } else if (source.knowledge_document_id) {
    // Usage changed away from knowledge/both on a refresh — drop the
    // now-orphaned document rather than leaving stale text reachable by
    // retrieveKnowledge(). No new document is being written in this
    // branch, so there is nothing to protect by reordering — a plain
    // delete is the correct, complete action here.
    await db.from('ai_knowledge_documents').delete().eq('id', source.knowledge_document_id)
    await db.from('ai_data_sources').update({ knowledge_document_id: null }).eq('id', source.id)
    source.knowledge_document_id = null
  }

  // ---- catalog side: structured rows, NEVER written to the KB.
  //
  // Bug #1 fix (refresh atomicity): same root cause and same fix shape
  // as the knowledge-document block above — the previous generation's
  // rows are captured and only removed AFTER the new generation has
  // been inserted successfully, so a failed insert can never leave the
  // account with an empty catalog for this source.
  //
  // Exception, unchanged from prior behavior: when `rows` is genuinely
  // empty (the sync parsed successfully but produced zero catalog-
  // eligible rows — e.g. every row lacked any usable name column, see
  // inventory-parser.ts's buildProductRows), there is nothing to insert
  // and this is NOT a failure — it is an accurate "this source
  // currently has zero catalog rows" result. The previous generation is
  // still removed in that case, exactly as it was before this fix,
  // because leaving stale rows behind would misrepresent the source's
  // real current content. Only a genuine INSERT ERROR (not "zero rows
  // to insert") is now non-destructive.
  if (usage === 'catalog' || usage === 'both') {
    const { data: previousProductRows, error: previousProductsErr } = await db
      .from('ai_catalog_products')
      .select('id')
      .eq('data_source_id', source.id)
    if (previousProductsErr) throw previousProductsErr
    const previousProductIds = (previousProductRows ?? []).map((r) => (r as { id: string }).id)

    const rows = toCatalogProductRows(parsed.products, source.id, accountId, opts.currency)
    if (rows.length > 0) {
      const { error: insErr } = await db.from('ai_catalog_products').insert(rows)
      if (insErr) throw insErr
    }
    if (previousProductIds.length > 0) {
      const { error: delErr } = await db.from('ai_catalog_products').delete().in('id', previousProductIds)
      if (delErr) throw delErr
    }
  } else {
    await db.from('ai_catalog_products').delete().eq('data_source_id', source.id)
  }

  return source
}

/**
 * Bug #4 fix: two rows in the same source sharing the same SKU value
 * (a data-entry mistake in the sheet, a re-exported ERP file, two
 * variants that mistakenly carry one SKU, ...) used to collide on the
 * exact same `source_product_id` (`p.sku ?? row-${p.rowIndex}` with no
 * uniqueness check) — nothing in the schema prevents it either (no
 * UNIQUE constraint on (data_source_id, source_product_id), and none is
 * being added in this pass). Both rows still got inserted, silently
 * identical, which broke every by-id follow-up
 * (getProduct/getAvailability/getProductMedia's `.maybeSingle()` lookup
 * no longer matched exactly one row for that id) even though
 * search_catalog kept showing both as if they were fine.
 *
 * Fix: the FIRST row to use a given SKU in this sync keeps using it as
 * `source_product_id`, byte-identical to before this fix. Any LATER row
 * whose SKU repeats one already claimed in this same sync falls back to
 * the SAME rowIndex-based id already used for rows with no SKU at all —
 * `rowIndex` is unique per row by construction, so this can never
 * collide with anything else. Neither row is ever dropped or merged;
 * `sku` itself (a plain display/lookup field, not the id) still shows
 * the real, duplicated value on both rows. A source with no duplicate
 * SKUs produces byte-identical output to before this fix.
 */
function toCatalogProductRows(
  products: CatalogProductRow[],
  dataSourceId: string,
  accountId: string,
  currency: string,
) {
  const seenSourceProductIds = new Set<string>()
  return products.map((p) => {
    let sourceProductId = p.sku ?? `row-${p.rowIndex}`
    if (seenSourceProductIds.has(sourceProductId)) {
      sourceProductId = `row-${p.rowIndex}`
    }
    seenSourceProductIds.add(sourceProductId)

    return {
      account_id: accountId,
      data_source_id: dataSourceId,
      source_product_id: sourceProductId,
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
    }
  })
}

/**
 * Validates a `google_sheets` source's URL by its REAL hostname, not a
 * substring of the whole URL string. The previous check
 * (`url.includes('docs.google.com/spreadsheets')`) accepted anything
 * containing that text ANYWHERE in the URL — including in the PATH of a
 * completely different host, e.g. `https://evil.com/docs.google.com/
 * spreadsheets/...` (attacker's own domain, arbitrary path) or a
 * lookalike subdomain like `docs.google.com.evil.com` (a real,
 * different, attacker-controlled hostname that merely starts with the
 * expected string). Neither is actually docs.google.com; this is a
 * "type confusion" gap the FASE 4 audit found — not itself a bypass of
 * `assertSafeUrl`'s SSRF protection (that still validates the real
 * resolved host/IP regardless of source_type), but a source labeled
 * "Google Sheets" should not silently be a URL to an unrelated host.
 */
function assertGoogleSheetsUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new DataSourceError(
      'Not a valid Google Sheets URL. Publish your sheet as CSV and paste the export URL.',
    )
  }
  const hostname = parsed.hostname.toLowerCase()
  if (hostname !== 'docs.google.com' || !parsed.pathname.startsWith('/spreadsheets')) {
    throw new DataSourceError(
      'Not a valid Google Sheets URL. Publish your sheet as CSV and paste the export URL.',
    )
  }
}

const MAX_FETCH_REDIRECTS = 5

/**
 * Fetches `url` as text, applying SSRF protection (assertSafeUrl) to
 * BOTH the original URL and every redirect hop — `redirect: 'manual'`
 * so a "safe" public URL can't 302 its way to a blocked address without
 * this function ever re-checking it (see the module doc above for what
 * this does and does not close).
 */
async function fetchCsv(url: string): Promise<string> {
  let currentUrl = url
  let res: Response
  for (let hop = 0; ; hop++) {
    if (hop > MAX_FETCH_REDIRECTS) {
      throw new DataSourceError('Too many redirects.')
    }
    await assertSafeUrl(currentUrl)
    try {
      res = await fetch(currentUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    } catch {
      throw new DataSourceError('Could not reach the URL. Check the link and try again.')
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new DataSourceError('The URL redirected without a destination.')
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }
    break
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
  if (!existing) throw new DataSourceNotFoundError()

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
