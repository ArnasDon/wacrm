import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type CatalogTaxonomyKind = 'category' | 'color'

export interface CatalogTaxonomyGroups {
  categoryGroups: string[][]
  colorGroups: string[][]
}

interface CatalogTaxonomyRow {
  kind: string
  canonical_value: string
  aliases: string[] | null
}

/**
 * Built-in fallback vocabulary, used only when an account has not
 * configured its own `catalog_taxonomy_terms` rows for a given kind (or
 * when the lookup itself fails). This used to live as two separately
 * hardcoded — and already drifted — copies in agent-search.ts and
 * search.ts; consolidated here as the single fallback, not the primary
 * mechanism. It reflects one tenant's (LC Fitness) original vocabulary
 * and exists only so accounts that pre-date per-tenant taxonomy keep
 * working unchanged. New accounts should configure their own taxonomy
 * instead of relying on this list.
 */
export const DEFAULT_CATEGORY_GROUPS: readonly (readonly string[])[] = [
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

export const DEFAULT_COLOR_GROUPS: readonly (readonly string[])[] = [
  ['preto', 'preta', 'pretos', 'pretas', 'negro', 'negra'],
  ['branco', 'branca', 'brancos', 'brancas'],
  ['azul', 'azuis', 'azul claro', 'azul escuro', 'azul-claro', 'azul-escuro'],
  ['vermelho', 'vermelha', 'vermelhos', 'vermelhas'],
  ['verde', 'verdes'],
  ['amarelo', 'amarela', 'amarelos', 'amarelas'],
  ['roxo', 'roxa', 'roxos', 'roxas', 'lilas', 'lils'],
  ['rosa', 'rosas', 'cor de rosa'],
  ['cinza', 'cinzento', 'cinzenta', 'cinzentos', 'cinzentas'],
  ['bege', 'beges'],
  ['laranja', 'laranjas'],
  ['dourado', 'dourada', 'dourados', 'douradas'],
  ['prateado', 'prateada', 'prateados', 'prateadas'],
] as const

function cloneDefaults(groups: readonly (readonly string[])[]): string[][] {
  return groups.map((group) => [...group])
}

function groupsFromRows(rows: CatalogTaxonomyRow[]): string[][] {
  return rows.map((row) => {
    const aliases = Array.isArray(row.aliases)
      ? row.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0)
      : []
    return Array.from(new Set([row.canonical_value, ...aliases]))
  })
}

/**
 * Loads one account's own category/colour taxonomy. Falls back to the
 * built-in generic defaults above, per kind, for any kind the account
 * has not configured — and on any lookup failure — so a brand-new
 * tenant with zero rows here behaves exactly like an already-configured
 * one, just with generic (rather than tenant-tuned) alias matching.
 */
export async function loadCatalogTaxonomy(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<CatalogTaxonomyGroups> {
  try {
    const { data, error } = await db
      .from('catalog_taxonomy_terms')
      .select('kind, canonical_value, aliases')
      .eq('account_id', accountId)
      .eq('enabled', true)

    if (error) throw error
    const rows = (data ?? []) as CatalogTaxonomyRow[]
    const categoryRows = rows.filter((row) => row.kind === 'category')
    const colorRows = rows.filter((row) => row.kind === 'color')

    return {
      categoryGroups: categoryRows.length > 0 ? groupsFromRows(categoryRows) : cloneDefaults(DEFAULT_CATEGORY_GROUPS),
      colorGroups: colorRows.length > 0 ? groupsFromRows(colorRows) : cloneDefaults(DEFAULT_COLOR_GROUPS),
    }
  } catch (error) {
    console.warn('[catalog taxonomy] falling back to default vocabulary:', error)
    return {
      categoryGroups: cloneDefaults(DEFAULT_CATEGORY_GROUPS),
      colorGroups: cloneDefaults(DEFAULT_COLOR_GROUPS),
    }
  }
}

/**
 * Loads only this account's own configured category canonical values,
 * with NO fallback to the built-in defaults — an empty array means "this
 * account has not configured any categories", not "use LC Fitness's
 * list". Used where leaking the fallback vocabulary into an unrelated
 * tenant's output (e.g. the photo classifier's suggested categories)
 * would be wrong, unlike search matching where the fallback is a
 * deliberate, safe default.
 */
export async function loadAccountCategoryTerms(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<string[]> {
  try {
    const { data, error } = await db
      .from('catalog_taxonomy_terms')
      .select('canonical_value')
      .eq('account_id', accountId)
      .eq('kind', 'category')
      .eq('enabled', true)

    if (error) throw error
    const rows = (data ?? []) as Array<{ canonical_value: string }>
    return Array.from(new Set(rows.map((row) => row.canonical_value).filter(Boolean)))
  } catch (error) {
    console.warn('[catalog taxonomy] failed to load account category terms:', error)
    return []
  }
}
