import { describe, expect, it } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import {
  DEFAULT_CATEGORY_GROUPS,
  DEFAULT_COLOR_GROUPS,
  loadAccountCategoryTerms,
  loadCatalogTaxonomy,
} from './taxonomy'

type TermRow = { account_id: string; kind: string; canonical_value: string; aliases: string[]; enabled: boolean }

function dbWithTerms(rows: TermRow[]): WacrmSupabaseClient {
  return {
    from: (table: string) => {
      if (table !== 'catalog_taxonomy_terms') throw new Error(`unexpected table ${table}`)
      const state: { accountId?: string } = {}
      const chain = {
        select: () => chain,
        eq: (column: string, value: string | boolean) => {
          if (column === 'account_id') state.accountId = value as string
          return chain
        },
        then: (resolve: (result: { data: TermRow[]; error: null }) => unknown) =>
          resolve({ data: rows.filter((row) => row.account_id === state.accountId && row.enabled), error: null }),
      }
      return chain
    },
  } as unknown as WacrmSupabaseClient
}

const tenantARows: TermRow[] = [
  { account_id: 'tenant-a', kind: 'category', canonical_value: 'legging', aliases: ['leggings', 'colante'], enabled: true },
]

const tenantBRows: TermRow[] = [
  { account_id: 'tenant-b', kind: 'category', canonical_value: 'SUV', aliases: ['jipe', 'crossover'], enabled: true },
]

describe('loadCatalogTaxonomy — tenant isolation', () => {
  it('never lets tenant A taxonomy leak into tenant B results', async () => {
    const db = dbWithTerms([...tenantARows, ...tenantBRows])

    const a = await loadCatalogTaxonomy(db, 'tenant-a')
    const b = await loadCatalogTaxonomy(db, 'tenant-b')

    expect(a.categoryGroups).toEqual([['legging', 'leggings', 'colante']])
    expect(b.categoryGroups).toEqual([['SUV', 'jipe', 'crossover']])
    expect(JSON.stringify(a.categoryGroups)).not.toContain('SUV')
    expect(JSON.stringify(b.categoryGroups)).not.toContain('legging')
  })

  it('falls back to the built-in generic vocabulary for an account with no configured taxonomy', async () => {
    const db = dbWithTerms([])

    const result = await loadCatalogTaxonomy(db, 'brand-new-account')

    expect(result.categoryGroups).toEqual(DEFAULT_CATEGORY_GROUPS.map((group) => [...group]))
    expect(result.colorGroups).toEqual(DEFAULT_COLOR_GROUPS.map((group) => [...group]))
  })

  it('falls back to defaults when the lookup itself fails, instead of throwing', async () => {
    const brokenDb = { from: () => { throw new Error('connection refused') } } as unknown as WacrmSupabaseClient

    const result = await loadCatalogTaxonomy(brokenDb, 'any-account')

    expect(result.categoryGroups.length).toBeGreaterThan(0)
    expect(result.colorGroups.length).toBeGreaterThan(0)
  })
})

describe('loadAccountCategoryTerms — no fallback leakage', () => {
  it('returns only this account own configured categories', async () => {
    const db = dbWithTerms([...tenantARows, ...tenantBRows])

    expect(await loadAccountCategoryTerms(db, 'tenant-a')).toEqual(['legging'])
    expect(await loadAccountCategoryTerms(db, 'tenant-b')).toEqual(['SUV'])
  })

  it('returns an empty list — never the LC Fitness defaults — for an unconfigured account', async () => {
    const db = dbWithTerms([])

    const categories = await loadAccountCategoryTerms(db, 'brand-new-account')

    expect(categories).toEqual([])
  })
})
