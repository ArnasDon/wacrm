// ============================================================
// Integration Resolver — the single place that turns "this account's
// configured catalog sources" into an ordered list of CatalogProvider
// instances, and the only place the generic catalog tools (search_
// catalog/get_product/get_availability/get_product_media) go through to
// reach one.
//
// account_id always comes from the caller (the auto-reply/playground
// dispatcher, itself keyed off the authenticated conversation/session —
// see src/lib/ai/auto-reply.ts). Nothing here accepts an account/tenant
// id from tool-call arguments, matching
// docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
// ("MULTI-TENANT" — "Nunca aceptar account_id como autoridad desde el
// LLM").
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { decodeCatalogId } from './id'
import { buildBudunClient, loadActiveCatalogIntegrations } from './integrations'
import { BudunProvider } from './providers/budun-provider'
import { DataSourceCatalogProvider, dataSourceProviderKey } from './providers/data-source-provider'
import type {
  CatalogAvailability,
  CatalogMedia,
  CatalogProduct,
  CatalogProvider,
  CatalogSearchArgs,
  CatalogSearchResult,
} from './types'

type FallbackPolicy = 'primary_only' | 'fallback_on_not_found' | 'search_all_active'

interface ResolvedProvider {
  provider: CatalogProvider
  isPrimary: boolean
  priority: number
  fallbackPolicy: FallbackPolicy
}

interface DataSourceRow {
  id: string
  display_name: string
  status: string
  usage: string
  priority: number
  is_primary: boolean
  fallback_policy: FallbackPolicy
}

/**
 * Every active catalog-capable provider for this account, ordered
 * primary-first then by priority (lower = higher priority). Used both
 * for free-text search (which may fan out per `fallback_policy`) and to
 * reconstruct a single provider by its key for by-id follow-ups.
 */
export async function resolveCatalogProviders(
  db: SupabaseClient,
  accountId: string,
): Promise<ResolvedProvider[]> {
  const resolved: ResolvedProvider[] = []

  const integrations = await loadActiveCatalogIntegrations(db, accountId)
  for (const { row, secret } of integrations) {
    const client = buildBudunClient(row, secret)
    resolved.push({
      provider: new BudunProvider(row.id, row.display_name, client),
      isPrimary: row.is_primary,
      priority: row.priority,
      // Budun ERP integrations don't carry their own fallback_policy
      // column (that concept is defined per Data Source in the spec) —
      // an active primary integration is always tried; a non-primary
      // one only participates in search_all_active fan-out.
      fallbackPolicy: row.is_primary ? 'fallback_on_not_found' : 'search_all_active',
    })
  }

  const { data: sources, error } = await db
    .from('ai_data_sources')
    .select('id, display_name, status, usage, priority, is_primary, fallback_policy')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .in('usage', ['catalog', 'both'])
  if (error) {
    console.error('[catalog resolver] failed to load data sources:', error.message)
  }
  for (const s of (sources ?? []) as DataSourceRow[]) {
    resolved.push({
      provider: new DataSourceCatalogProvider(db, accountId, s.id, s.display_name),
      isPrimary: s.is_primary,
      priority: s.priority,
      fallbackPolicy: s.fallback_policy,
    })
  }

  resolved.sort((a, b) => (a.isPrimary === b.isPrimary ? a.priority - b.priority : a.isPrimary ? -1 : 1))
  return resolved
}

/** True when the account has at least one active catalog source —
 *  callers use this to decide whether to register the generic catalog
 *  tools at all (accounts with nothing configured see zero behavior
 *  change, same prompt/pipeline as before this feature). */
export async function hasActiveCatalogSources(db: SupabaseClient, accountId: string): Promise<boolean> {
  const resolved = await resolveCatalogProviders(db, accountId)
  return resolved.length > 0
}

/** Reconstruct the single provider a composite id (or a resolved list)
 *  refers to, without re-resolving everything when a list is already in
 *  hand. Returns null for an id that doesn't decode or doesn't match any
 *  currently-active provider — a fabricated/stale id is "not found",
 *  never routed anywhere by guesswork. */
function findProviderForId(providers: ResolvedProvider[], id: string): { provider: CatalogProvider; nativeId: string } | null {
  const decoded = decodeCatalogId(id)
  if (!decoded) return null
  const match = providers.find((p) => p.provider.key === decoded.providerKey)
  if (!match) return null
  return { provider: match.provider, nativeId: decoded.nativeId }
}

/**
 * `total`/`hasMore` are what let the agent know it's looking at a
 * partial page rather than the whole matching inventory (AI Sales
 * Agent audit, Part 2) — this was the real architectural gap behind
 * "shows 2 KOOLHOME TVs and presents that as the full lineup" when
 * Samsung/TCL rows existed too: the tool layer had a hardcoded limit
 * and no way to say "there's more".
 *
 * Pagination across MULTIPLE merged providers (fallback_policy
 * 'search_all_active') doesn't compose from independent per-provider
 * offsets — each provider is instead asked for its own rows from 0
 * through `offset + limit`, and the single requested page is sliced
 * out of the concatenation. Correct always; only "wastes" a bounded
 * amount of re-fetched work for a very large offset across many
 * providers, which the tool layer caps anyway.
 */
export async function searchCatalog(
  db: SupabaseClient,
  accountId: string,
  args: CatalogSearchArgs,
): Promise<CatalogSearchResult> {
  const providers = await resolveCatalogProviders(db, accountId)
  const limit = args.limit ?? 10
  const offset = args.offset ?? 0
  const fetchCount = offset + limit

  const collected: CatalogProduct[] = []
  let total: number | null = 0
  let anyHasMore = false

  for (const { provider, fallbackPolicy } of providers) {
    let result: CatalogSearchResult = { products: [], total: null, hasMore: false }
    try {
      result = await provider.searchCatalog({ ...args, limit: fetchCount, offset: 0 })
    } catch (err) {
      console.error(`[catalog resolver] search failed on provider ${provider.key}:`, err instanceof Error ? err.message : err)
    }
    collected.push(...result.products)
    total = total === null || result.total === null ? null : total + result.total
    if (result.hasMore) anyHasMore = true

    // 'primary_only' never falls through to another source, found or
    // not. 'fallback_on_not_found' (the default) stops as soon as one
    // provider actually found something. 'search_all_active' always
    // continues, merging every active source's results.
    if (fallbackPolicy === 'primary_only') break
    if (fallbackPolicy === 'fallback_on_not_found' && result.products.length > 0) break
  }

  const page = collected.slice(offset, offset + limit)
  const hasMore = anyHasMore || collected.length > offset + limit
  return { products: page, total, hasMore }
}

export async function getProduct(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<CatalogProduct | null> {
  const providers = await resolveCatalogProviders(db, accountId)
  const target = findProviderForId(providers, id)
  if (!target) return null
  return target.provider.getProduct(target.nativeId)
}

export async function getAvailability(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<CatalogAvailability | null> {
  const providers = await resolveCatalogProviders(db, accountId)
  const target = findProviderForId(providers, id)
  if (!target) return null
  return target.provider.getAvailability(target.nativeId)
}

export async function getProductMedia(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<CatalogMedia | null> {
  const providers = await resolveCatalogProviders(db, accountId)
  const target = findProviderForId(providers, id)
  if (!target) return null
  return target.provider.getMedia(target.nativeId)
}

// Re-exported for tests / call sites that need to build a provider key
// without going through the full resolver.
export { dataSourceProviderKey }
