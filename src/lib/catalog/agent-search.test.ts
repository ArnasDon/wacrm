import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { searchCatalogues } from './search'
import { catalogProductKey, searchCatalogForAgent } from './agent-search'
import type { CatalogProduct } from './types'

vi.mock('./search', () => ({ searchCatalogues: vi.fn() }))

const products: CatalogProduct[] = [
  {
    id: 'legging-black',
    name: 'Legging Cintura Alta',
    description: 'Cor: preta. Cintura alta.',
    price: 2800,
    currency: 'MZN',
    imageUrl: 'https://cdn.example.com/legging-black.jpg',
    productUrl: null,
    category: 'legging',
    stockQuantity: 5,
    variants: [
      { id: 'v1', size: 'M', color: 'preta', stockQuantity: 2, imageUrl: null },
    ],
    sourceName: 'LC Fitness',
  },
  {
    id: 'legging-blue',
    name: 'Legging Azul',
    description: 'Cor: azul.',
    price: 3000,
    currency: 'MZN',
    imageUrl: 'https://cdn.example.com/legging-blue.jpg',
    productUrl: null,
    category: 'legging',
    stockQuantity: 4,
    sourceName: 'LC Fitness',
  },
  {
    id: 'shirt-black',
    name: 'Camiseta Preta',
    description: 'Cor: preta.',
    price: 2000,
    currency: 'MZN',
    imageUrl: 'https://cdn.example.com/shirt-black.jpg',
    productUrl: null,
    category: 'camiseta',
    stockQuantity: 5,
    sourceName: 'LC Fitness',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(searchCatalogues).mockResolvedValue(products)
})

describe('searchCatalogForAgent', () => {
  it('enforces explicit category and colour together', async () => {
    const result = await searchCatalogForAgent({} as WacrmSupabaseClient, 'account-1', {
      query: 'legging',
      category: 'legging',
      color: 'preta',
      size: null,
      mode: 'browse',
      limit: 8,
    })

    expect(result.map(({ product }) => product.id)).toEqual(['legging-black'])
  })

  it('never lets a colour-only match from another category leak through', async () => {
    const result = await searchCatalogForAgent({} as WacrmSupabaseClient, 'account-1', {
      query: 'preta',
      category: 'legging',
      color: 'preta',
      size: null,
      mode: 'browse',
      limit: 8,
    })

    expect(result.map(({ product }) => product.id)).not.toContain('shirt-black')
    expect(result.map(({ product }) => product.id)).toEqual(['legging-black'])
  })

  it('excludes stable product keys already shown by the conversation', async () => {
    const result = await searchCatalogForAgent({} as WacrmSupabaseClient, 'account-1', {
      query: 'legging',
      category: 'legging',
      mode: 'browse',
      limit: 8,
      excludeProductKeys: [catalogProductKey(products[0])],
    })

    expect(result.map(({ product }) => product.id)).toEqual(['legging-blue'])
  })

  it('marks requested size as match, unknown or mismatch without inventing availability', async () => {
    const result = await searchCatalogForAgent({} as WacrmSupabaseClient, 'account-1', {
      query: 'legging',
      category: 'legging',
      size: 'M',
      mode: 'lookup',
      limit: 8,
    })

    const byId = new Map(result.map((item) => [item.product.id, item.sizeMatch]))
    expect(byId.get('legging-black')).toBe('match')
    expect(byId.get('legging-blue')).toBe('unknown')
  })

  it('keeps a compound category such as saia-calção more specific than calção', async () => {
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'skort-1',
        name: 'Saia-Calção com Pregas',
        description: 'Cor: preta.',
        price: 2300,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/skort.jpg',
        productUrl: null,
        category: 'saia-calção',
        stockQuantity: 3,
        sourceName: 'LC Fitness',
      },
      {
        id: 'short-1',
        name: 'Calção de Treino',
        description: 'Cor: preta.',
        price: 1800,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/short.jpg',
        productUrl: null,
        category: 'calção',
        stockQuantity: 4,
        sourceName: 'LC Fitness',
      },
    ])

    const result = await searchCatalogForAgent({} as WacrmSupabaseClient, 'account-1', {
      query: 'saia-calção',
      category: 'saia-calção',
      mode: 'browse',
      limit: 8,
    })

    expect(result.map(({ product }) => product.id)).toEqual(['skort-1'])
  })
})

type TermRow = { account_id: string; kind: string; canonical_value: string; aliases: string[]; enabled: boolean }

function dbWithTaxonomy(rows: TermRow[]): WacrmSupabaseClient {
  return {
    from: () => {
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

describe('searchCatalogForAgent — per-account taxonomy', () => {
  it("lets LC find 'pantalona' through its own configured taxonomy, not a hardcoded core list", async () => {
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'pantalona-1',
        name: 'Pantalona Wide Leg',
        description: 'Cor: preta.',
        price: 3200,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/pantalona.jpg',
        productUrl: null,
        category: 'pantalona',
        stockQuantity: 4,
        sourceName: 'LC Fitness',
      },
    ])
    const db = dbWithTaxonomy([
      { account_id: 'lc-account', kind: 'category', canonical_value: 'pantalona', aliases: ['pantalonas', 'wide leg'], enabled: true },
    ])

    const result = await searchCatalogForAgent(db, 'lc-account', {
      query: 'pantalona',
      category: 'pantalona',
      mode: 'browse',
      limit: 8,
    })

    expect(result.map(({ product }) => product.id)).toEqual(['pantalona-1'])
  })

  it("lets a car-rental tenant match 'SUV' with zero code changes, using only its own configured taxonomy", async () => {
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'suv-1',
        name: 'Toyota RAV4',
        description: 'SUV automático.',
        price: 4500,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/rav4.jpg',
        productUrl: null,
        category: 'SUV',
        stockQuantity: 2,
        sourceName: 'Aluguer de Carros Maputo',
      },
      {
        id: 'sedan-1',
        name: 'Toyota Corolla',
        description: 'Sedan automático.',
        price: 3000,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/corolla.jpg',
        productUrl: null,
        category: 'sedan',
        stockQuantity: 3,
        sourceName: 'Aluguer de Carros Maputo',
      },
    ])
    const db = dbWithTaxonomy([
      { account_id: 'car-rental-account', kind: 'category', canonical_value: 'SUV', aliases: ['jipe', 'crossover'], enabled: true },
      { account_id: 'car-rental-account', kind: 'category', canonical_value: 'sedan', aliases: [], enabled: true },
    ])

    const result = await searchCatalogForAgent(db, 'car-rental-account', {
      query: 'jipe',
      category: 'jipe',
      mode: 'browse',
      limit: 8,
    })

    expect(result.map(({ product }) => product.id)).toEqual(['suv-1'])
  })

  it('never lets one tenant taxonomy match another tenant products', async () => {
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'suv-1',
        name: 'Toyota RAV4',
        description: 'SUV automático.',
        price: 4500,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/rav4.jpg',
        productUrl: null,
        category: 'SUV',
        stockQuantity: 2,
        sourceName: 'Aluguer de Carros Maputo',
      },
    ])
    // Only tenant B (car rental) has a "jipe" alias configured — tenant A
    // (LC, fashion) has none, and must never inherit it.
    const db = dbWithTaxonomy([
      { account_id: 'car-rental-account', kind: 'category', canonical_value: 'SUV', aliases: ['jipe'], enabled: true },
    ])

    const result = await searchCatalogForAgent(db, 'lc-account', {
      query: 'jipe',
      category: 'jipe',
      mode: 'browse',
      limit: 8,
    })

    // lc-account has no taxonomy rows of its own, so it falls back to the
    // generic defaults — which do not know "jipe" either — and the
    // unrelated SUV product from another tenant's catalogue must not
    // surface as a match just because a *different* account configured it.
    expect(result.map(({ product }) => product.id)).not.toContain('suv-1')
  })
})
