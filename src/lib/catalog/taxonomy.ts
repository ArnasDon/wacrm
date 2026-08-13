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

function groupsFromRows(rows: CatalogTaxonomyRow[]): string[][] {
  return rows.map((row) => {
    const aliases = Array.isArray(row.aliases)
      ? row.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0)
      : []
    return Array.from(new Set([row.canonical_value, ...aliases]))
  })
}

/**
 * Loads one account's own category/colour taxonomy. An account with no
 * rows for a given kind (or a lookup failure) gets an EMPTY group list
 * for that kind — never a built-in vocabulary. This module has no
 * knowledge of any business's category/colour words; the only place
 * that vocabulary should exist is tenant data (see
 * 20260813093000_lc_fitness_taxonomy_and_style_skill.sql for LC's own).
 *
 * An empty group list does not mean "no matching happens": the callers
 * (agent-search.ts's categoryMatches/colorMatches, search.ts's
 * buildSearchVariants) already fall back to plain substring/token
 * matching on the raw requested text when no alias group matches —
 * that generic textual matching keeps working with zero configured
 * taxonomy, just without synonym/gender-inflection expansion.
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
      categoryGroups: groupsFromRows(categoryRows),
      colorGroups: groupsFromRows(colorRows),
    }
  } catch (error) {
    console.warn('[catalog taxonomy] lookup failed, matching with no alias groups:', error)
    return { categoryGroups: [], colorGroups: [] }
  }
}

/**
 * Loads only this account's own configured category canonical values.
 * An empty array means "this account has not configured any
 * categories" — never a built-in list. Used by the photo classifier so
 * an account with nothing configured gets a domain-neutral prompt.
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
