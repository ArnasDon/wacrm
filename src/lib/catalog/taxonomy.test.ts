import { describe, expect, it } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { loadAccountCategoryTerms, loadCatalogTaxonomy } from './taxonomy'

type TermRow = { account_id: string; kind: string; canonical_value: string; aliases: string[]; enabled: boolean }

function dbWithTerms(rows: TermRow[]): WacrmSupabaseClient {
  return {
    from: (table: string) => {
      if (table !== 'catalog_taxonomy_terms') throw new Error(`unexpected table ${table}`)
      const state: { accountId?: string; kind?: string } = {}
      const chain = {
        select: () => chain,
        eq: (column: string, value: string | boolean) => {
          if (column === 'account_id') state.accountId = value as string
          if (column === 'kind') state.kind = value as string
          return chain
        },
        then: (resolve: (result: { data: TermRow[]; error: null }) => unknown) =>
          resolve({
            data: rows.filter(
              (row) =>
                row.account_id === state.accountId &&
                row.enabled &&
                (state.kind === undefined || row.kind === state.kind),
            ),
            error: null,
          }),
      }
      return chain
    },
  } as unknown as WacrmSupabaseClient
}

const lcRows: TermRow[] = [
  { account_id: 'lc-account', kind: 'category', canonical_value: 'legging', aliases: ['leggings', 'colante'], enabled: true },
  { account_id: 'lc-account', kind: 'color', canonical_value: 'preto', aliases: ['preta'], enabled: true },
]

const carRentalRows: TermRow[] = [
  { account_id: 'car-rental-account', kind: 'category', canonical_value: 'SUV', aliases: ['jipe', 'crossover'], enabled: true },
]

describe('loadCatalogTaxonomy — no built-in vocabulary in the core', () => {
  it("returns LC's own configured aliases for LC's account", async () => {
    const db = dbWithTerms([...lcRows, ...carRentalRows])

    const result = await loadCatalogTaxonomy(db, 'lc-account')

    expect(result.categoryGroups).toEqual([['legging', 'leggings', 'colante']])
    expect(result.colorGroups).toEqual([['preto', 'preta']])
  })

  it("returns the car-rental tenant's own configured aliases, isolated from LC's", async () => {
    const db = dbWithTerms([...lcRows, ...carRentalRows])

    const result = await loadCatalogTaxonomy(db, 'car-rental-account')

    expect(result.categoryGroups).toEqual([['SUV', 'jipe', 'crossover']])
    expect(JSON.stringify(result.categoryGroups)).not.toContain('legging')
  })

  it('returns empty groups — never LC Fitness aliases — for an account with no configured taxonomy', async () => {
    const db = dbWithTerms([...lcRows, ...carRentalRows])

    const result = await loadCatalogTaxonomy(db, 'brand-new-account')

    expect(result).toEqual({ categoryGroups: [], colorGroups: [] })
  })

  it('returns empty groups — never LC Fitness aliases — when the lookup itself fails', async () => {
    const brokenDb = { from: () => { throw new Error('connection refused') } } as unknown as WacrmSupabaseClient

    const result = await loadCatalogTaxonomy(brokenDb, 'any-account')

    expect(result).toEqual({ categoryGroups: [], colorGroups: [] })
  })
})

describe('loadAccountCategoryTerms — no fallback leakage', () => {
  it('returns only this account own configured categories', async () => {
    const db = dbWithTerms([...lcRows, ...carRentalRows])

    expect(await loadAccountCategoryTerms(db, 'lc-account')).toEqual(['legging'])
    expect(await loadAccountCategoryTerms(db, 'car-rental-account')).toEqual(['SUV'])
  })

  it('returns an empty list for an unconfigured account', async () => {
    const db = dbWithTerms([])

    expect(await loadAccountCategoryTerms(db, 'brand-new-account')).toEqual([])
  })
})
