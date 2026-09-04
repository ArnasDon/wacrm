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
import { checkCatalogExternalBudget } from '@/lib/rate-limit'
import { computeFacets } from './facets'
import { decodeCatalogId } from './id'
import { buildBudunClient, loadActiveCatalogIntegrations } from './integrations'
import { BudunProvider, isBudunProviderKey } from './providers/budun-provider'
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

/**
 * Sentinel returned by getProduct/getAvailability/getProductMedia
 * IN PLACE OF `null` when the target is an EXTERNAL (Budun) provider and
 * this account's external-call budget for the current window is
 * exhausted (RATE_LIMITS.catalogExternalAccount) — the HTTP call was
 * never attempted. Deliberately distinct from `null` (which still means,
 * exactly as before, "resolved a provider but the item genuinely wasn't
 * found there"): catalog-tools.ts checks for this specific value so a
 * rate-limit block is never reported to the model as a false
 * "not_found"/"no disponible" — see this module's `searchCatalog` doc
 * for the equivalent case when multiple providers are involved.
 */
export const EXTERNAL_LIMIT_REACHED = 'external_limit_reached' as const
type ExternalLimitReached = typeof EXTERNAL_LIMIT_REACHED

/** True (and consumes one unit of the account's external-call budget)
 *  only when `provider` is Budun-backed AND that budget still had room;
 *  always true immediately, with no budget consumed, for the internal
 *  Sheet/CSV catalog — it's never gated by this check at all.
 *
 * Observability (FASE 12) — this is the ONE choke point all four
 * catalog tools (search_catalog/get_product/get_availability/
 * get_product_media) already call through, so a single `console.warn`
 * here gives log-based visibility into "cuándo se alcanza el límite"
 * across all of them, with zero change to the return value, zero new
 * query, and zero change to catalog behavior — pure instrumentation of
 * a real execution point, per the FASE 12 authorization. Only the
 * BLOCKED case is logged; logging every successful call would spam
 * production logs for no operational benefit — operators care about
 * the rare "budget exhausted" event, not the common case. */
function tryConsumeExternalBudget(accountId: string, provider: CatalogProvider): boolean {
  if (!isBudunProviderKey(provider.key)) return true
  const allowed = checkCatalogExternalBudget(accountId)
  if (!allowed) {
    console.warn(`[catalog external] budget exhausted — account=${accountId} provider=${provider.key}`)
  }
  return allowed
}

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
 * Per-dispatch memoization for `resolveCatalogProviders` — AI
 * optimization project, FASE 3. A single customer turn can call
 * search_catalog → get_product → get_availability → get_product_media
 * in sequence (see tools/catalog-tools.ts), and each of those, plus the
 * earlier `hasActiveCatalogSources` gate, independently re-resolved
 * `catalog_integrations` + `ai_data_sources` from scratch — up to 5
 * redundant round trips for data that cannot have changed mid-turn.
 *
 * Callers create exactly ONE `ResolverCache` per `generateReply()`
 * dispatch (see auto-reply.ts / playground/route.ts) and thread it
 * through every resolver call for that turn. It is a plain object held
 * in one closure's memory — never a module-level/global map, never
 * written to a database or persisted anywhere, so it cannot outlive the
 * request that created it, cannot leak between accounts (a fresh object
 * per dispatch, never keyed/shared), and cannot serve stale data across
 * turns (the next inbound message creates a brand-new cache). Passing
 * no cache at all (every existing caller/test) reproduces today's
 * behavior exactly — resolve fresh, every time.
 */
export interface ResolverCache {
  providers?: Promise<ResolvedProvider[]>
}

/** Fresh, empty cache for one dispatch. */
export function createResolverCache(): ResolverCache {
  return {}
}

/**
 * Every active catalog-capable provider for this account, ordered
 * primary-first then by priority (lower = higher priority). Used both
 * for free-text search (which may fan out per `fallback_policy`) and to
 * reconstruct a single provider by its key for by-id follow-ups.
 *
 * Pass `cache` (see `ResolverCache` above) to reuse one resolution
 * across every catalog tool call within the same turn; omit it to
 * resolve fresh, exactly as before this parameter existed.
 */
export async function resolveCatalogProviders(
  db: SupabaseClient,
  accountId: string,
  cache?: ResolverCache,
): Promise<ResolvedProvider[]> {
  if (cache) {
    if (!cache.providers) cache.providers = resolveCatalogProvidersUncached(db, accountId)
    return cache.providers
  }
  return resolveCatalogProvidersUncached(db, accountId)
}

async function resolveCatalogProvidersUncached(
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
export async function hasActiveCatalogSources(
  db: SupabaseClient,
  accountId: string,
  cache?: ResolverCache,
): Promise<boolean> {
  const resolved = await resolveCatalogProviders(db, accountId, cache)
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
  cache?: ResolverCache,
): Promise<CatalogSearchResult> {
  const providers = await resolveCatalogProviders(db, accountId, cache)
  const limit = args.limit ?? 10
  const offset = args.offset ?? 0
  const fetchCount = offset + limit

  const collected: CatalogProduct[] = []
  let total: number | null = 0
  let anyHasMore = false
  let externalLimitReached = false
  // Observability (FASE 12) — true the moment a Budun-backed provider is
  // ACTUALLY invoked (budget allowed it). Distinct from
  // `externalLimitReached`: the two are not mutually exclusive across a
  // `search_all_active` fan-out (e.g. two configured Budun integrations,
  // one blocked and one still within budget). Never a second query —
  // just observing what this same loop already does.
  let externalUsed = false

  for (const { provider, fallbackPolicy } of providers) {
    let result: CatalogSearchResult = { products: [], total: null, hasMore: false }
    if (!tryConsumeExternalBudget(accountId, provider)) {
      // Budun-backed AND this account's external-call budget is
      // exhausted for the current window — the HTTP call is never made.
      // Treated exactly like "this provider found nothing" for the
      // fallback-chain logic below (an internal Sheet/CSV source further
      // down the chain still runs normally), but flagged distinctly so
      // catalog-tools.ts never reports this as a false "producto no
      // disponible" — see EXTERNAL_LIMIT_REACHED's doc.
      externalLimitReached = true
    } else {
      if (isBudunProviderKey(provider.key)) externalUsed = true
      try {
        result = await provider.searchCatalog({ ...args, limit: fetchCount, offset: 0 })
      } catch (err) {
        console.error(`[catalog resolver] search failed on provider ${provider.key}:`, err instanceof Error ? err.message : err)
      }
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
  // Facets (AI optimization project, FASE 11) — computed from `collected`
  // (everything every queried provider actually returned this call,
  // BEFORE the offset/limit slice), not just `page`: it's already fully
  // in memory at zero extra cost, and it's a strictly more representative
  // sample than the final page alone. Never a second query, never a
  // second Budun call — see catalog/facets.ts's module doc.
  const facets = computeFacets(collected)
  return {
    products: page,
    total,
    hasMore,
    ...(externalLimitReached ? { externalLimitReached: true } : {}),
    ...(externalUsed ? { externalUsed: true } : {}),
    ...(facets ? { facets } : {}),
  }
}

export async function getProduct(
  db: SupabaseClient,
  accountId: string,
  id: string,
  cache?: ResolverCache,
): Promise<CatalogProduct | null | ExternalLimitReached> {
  const providers = await resolveCatalogProviders(db, accountId, cache)
  const target = findProviderForId(providers, id)
  if (!target) return null
  if (!tryConsumeExternalBudget(accountId, target.provider)) return EXTERNAL_LIMIT_REACHED
  return target.provider.getProduct(target.nativeId)
}

export async function getAvailability(
  db: SupabaseClient,
  accountId: string,
  id: string,
  cache?: ResolverCache,
): Promise<CatalogAvailability | null | ExternalLimitReached> {
  const providers = await resolveCatalogProviders(db, accountId, cache)
  const target = findProviderForId(providers, id)
  if (!target) return null
  if (!tryConsumeExternalBudget(accountId, target.provider)) return EXTERNAL_LIMIT_REACHED
  return target.provider.getAvailability(target.nativeId)
}

export async function getProductMedia(
  db: SupabaseClient,
  accountId: string,
  id: string,
  cache?: ResolverCache,
): Promise<CatalogMedia | null | ExternalLimitReached> {
  const providers = await resolveCatalogProviders(db, accountId, cache)
  const target = findProviderForId(providers, id)
  if (!target) return null
  if (!tryConsumeExternalBudget(accountId, target.provider)) return EXTERNAL_LIMIT_REACHED
  return target.provider.getMedia(target.nativeId)
}

// Re-exported for tests / call sites that need to build a provider key
// without going through the full resolver.
export { dataSourceProviderKey }
