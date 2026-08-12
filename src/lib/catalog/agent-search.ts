import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { searchCatalogues } from './search'
import type { CatalogProduct } from './types'

export type AgentCatalogSearchMode = 'browse' | 'lookup'

export interface AgentCatalogSearchInput {
  query: string
  category?: string | null
  color?: string | null
  size?: string | null
  limit: number
  mode: AgentCatalogSearchMode
  excludeProductKeys?: string[]
}

export interface RankedAgentCatalogProduct {
  product: CatalogProduct
  productKey: string
  score: number
  sizeMatch: 'match' | 'unknown' | 'mismatch'
}

const MAX_CANDIDATES = 60
const CANDIDATE_MULTIPLIER = 8

const CATEGORY_ALIASES = [
  ['legging', 'leggings', 'colante', 'colantes', 'calca de treino', 'calcas de treino', 'calca fitness', 'calcas fitness', 'tights'],
  ['camisola', 'camisolas', 'camiseta', 'camisetas', 't shirt', 't shirts', 'tshirt', 'tshirts'],
  ['top', 'tops'],
  ['saia calcao', 'saia calcoes', 'skort'],
  ['calcao', 'calcoes', 'short', 'shorts'],
  ['macacao', 'macacoes', 'jumpsuit'],
  ['conjunto', 'conjuntos', 'set'],
  ['sapatilha', 'sapatilhas', 'tenis', 'calcado desportivo', 'sapato desportivo'],
  ['saia', 'saias'],
  ['acessorio', 'acessorios'],
] as const

const COLOR_ALIASES = [
  ['preto', 'preta', 'pretos', 'pretas', 'negro', 'negra'],
  ['branco', 'branca', 'brancos', 'brancas'],
  ['azul', 'azuis'],
  ['vermelho', 'vermelha', 'vermelhos', 'vermelhas'],
  ['verde', 'verdes'],
  ['amarelo', 'amarela', 'amarelos', 'amarelas'],
  ['roxo', 'roxa', 'roxos', 'roxas', 'lilas'],
  ['rosa', 'rosas', 'cor de rosa'],
  ['cinza', 'cinzento', 'cinzenta', 'cinzentos', 'cinzentas'],
  ['bege', 'beges'],
  ['laranja', 'laranjas'],
  ['dourado', 'dourada', 'dourados', 'douradas'],
  ['prateado', 'prateada', 'prateados', 'prateadas'],
] as const

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value: string | null | undefined): string[] {
  return normalize(value)
    .split(' ')
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

export function catalogProductKey(product: CatalogProduct): string {
  return `${normalize(product.sourceName) || 'catalog'}:${product.id}`
}

function textIncludesAll(haystack: string, needles: string[]): boolean {
  return needles.length === 0 || needles.every((needle) => haystack.includes(needle))
}

function bestAliasGroup(
  requested: string,
  groups: readonly (readonly string[])[],
): string[] | null {
  const candidates = groups
    .map((group) => group.map(normalize))
    .map((group) => ({
      group,
      score: Math.max(
        0,
        ...group.map((alias) => {
          if (requested === alias) return 10_000 + alias.length
          if (requested.includes(alias) || alias.includes(requested)) return alias.length
          return 0
        }),
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
  return candidates[0]?.group ?? null
}

function matchesAliases(
  haystack: string,
  requested: string | null | undefined,
  groups: readonly (readonly string[])[],
): boolean {
  const normalizedRequested = normalize(requested)
  if (!normalizedRequested) return true
  const matchingGroup = bestAliasGroup(normalizedRequested, groups)
  if (matchingGroup) return matchingGroup.some((alias) => haystack.includes(alias))
  return textIncludesAll(haystack, tokens(normalizedRequested))
}

function categoryMatches(product: CatalogProduct, category: string | null | undefined): boolean {
  if (!normalize(category)) return true
  const explicitCategory = normalize(product.category)
  const fallback = normalize(`${product.name} ${product.description ?? ''}`)
  return (
    matchesAliases(explicitCategory, category, CATEGORY_ALIASES) ||
    matchesAliases(fallback, category, CATEGORY_ALIASES)
  )
}

function colorMatches(product: CatalogProduct, color: string | null | undefined): boolean {
  if (!normalize(color)) return true
  const values = [
    product.description ?? '',
    ...(product.variants ?? []).map((variant) => variant.color ?? ''),
  ]
  return matchesAliases(normalize(values.join(' ')), color, COLOR_ALIASES)
}

function productSizeMatch(
  product: CatalogProduct,
  size: string | null | undefined,
): 'match' | 'unknown' | 'mismatch' {
  const wanted = normalize(size)
  if (!wanted) return 'unknown'
  const sizes = (product.variants ?? [])
    .map((variant) => normalize(variant.size))
    .filter(Boolean)
  if (sizes.length === 0) return 'unknown'
  return sizes.includes(wanted) ? 'match' : 'mismatch'
}

function relevanceScore(product: CatalogProduct, input: AgentCatalogSearchInput): number {
  const name = normalize(product.name)
  const category = normalize(product.category)
  const description = normalize(product.description)
  const query = normalize(input.query)
  const wantedCategory = normalize(input.category)
  let score = 0

  if (query) {
    if (name === query) score += 160
    else if (name.startsWith(query)) score += 100
    else if (name.includes(query)) score += 70
    if (description.includes(query)) score += 25
    if (category.includes(query)) score += 35
  }
  if (wantedCategory) {
    if (category === wantedCategory) score += 120
    else if (categoryMatches(product, input.category)) score += 80
  }
  if (input.color && colorMatches(product, input.color)) score += 45
  if (product.imageUrl || product.variants?.some((variant) => variant.imageUrl)) score += 20
  if (product.stockQuantity !== null && product.stockQuantity > 0) score += 10

  const sizeMatch = productSizeMatch(product, input.size)
  if (sizeMatch === 'match') score += 50
  return score
}

function uniqueProducts(products: CatalogProduct[]): CatalogProduct[] {
  const unique = new Map<string, CatalogProduct>()
  for (const product of products) {
    const key = catalogProductKey(product)
    if (!unique.has(key)) unique.set(key, product)
  }
  return Array.from(unique.values())
}

function retrievalQueries(input: AgentCatalogSearchInput): string[] {
  const candidates = [input.query, input.category, input.color]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
  return Array.from(new Set(candidates)).slice(0, 3)
}

/**
 * Agent-facing catalogue retrieval.
 *
 * The legacy search layer is intentionally kept as a broad source adapter.
 * This layer fetches a wider candidate pool, applies explicit category/colour
 * constraints as AND conditions, removes products already shown by the live
 * conversation state, then ranks and limits. A known size mismatch is also
 * excluded; products with no size data stay eligible but are marked unknown
 * so the agent can be honest. It never sends WhatsApp media.
 */
export async function searchCatalogForAgent(
  db: WacrmSupabaseClient,
  accountId: string,
  input: AgentCatalogSearchInput,
): Promise<RankedAgentCatalogProduct[]> {
  const candidateLimit = Math.min(
    MAX_CANDIDATES,
    Math.max(20, input.limit * CANDIDATE_MULTIPLIER),
  )
  const queries = retrievalQueries(input)
  if (queries.length === 0) return []

  const settled = await Promise.allSettled(
    queries.map((query) => searchCatalogues(db, accountId, { query, limit: candidateLimit })),
  )
  const candidates = uniqueProducts(
    settled.flatMap((result) => {
      if (result.status === 'fulfilled') return result.value
      console.warn('[agent catalog search] source query failed:', result.reason)
      return []
    }),
  )

  const excluded = new Set(input.excludeProductKeys ?? [])
  return candidates
    .filter((product) => !excluded.has(catalogProductKey(product)))
    .filter((product) => categoryMatches(product, input.category))
    .filter((product) => colorMatches(product, input.color))
    .map((product) => ({ product, sizeMatch: productSizeMatch(product, input.size) }))
    .filter(({ sizeMatch }) => sizeMatch !== 'mismatch')
    .map(({ product, sizeMatch }) => ({
      product,
      productKey: catalogProductKey(product),
      score: relevanceScore(product, input),
      sizeMatch,
    }))
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'pt'))
    .slice(0, input.limit)
}
