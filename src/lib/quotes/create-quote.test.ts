import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQuote, CreateQuoteError } from './create-quote'

interface ProductRow {
  id: string
  name: string
  price: number
  installation_cost?: number | null
  is_active: boolean
}

interface PriceOptionRow {
  id: string
  product_id: string
  label: string
  price: number
  installation_cost: number | null
}

interface Fixture {
  products?: ProductRow[]
  priceOptions?: PriceOptionRow[]
  defaultCurrency?: string | null
  pipeline?: { id: string } | null
  stage?: { id: string } | null
  /** The contact's existing open deal, if any — `null`/omitted means
   *  none, so `createQuote` falls through to creating a new one. */
  existingOpenDeal?: { id: string } | null
}

const CUSTOMER = {
  customerNit: '123456-7',
  customerEmail: 'cliente@example.com',
  customerPhone: '+50212345678',
  customerAddress: 'Zona 10, Ciudad de Guatemala',
}

/** Thenable fake query builder — awaitable at any chain length, like
 *  the real PostgrestFilterBuilder (some chains terminate in `.in()` /
 *  `.maybeSingle()` / `.single()`, others just await the last `.eq()`). */
function makeDb(fx: Fixture) {
  const inserted: Record<string, Record<string, unknown>[]> = {}

  function builder(table: string) {
    const state: { mode: 'select' | 'insert'; insertPayload?: Record<string, unknown> | Record<string, unknown>[] } = {
      mode: 'select',
    }

    async function resolve() {
      if (state.mode === 'insert') {
        const rows = Array.isArray(state.insertPayload) ? state.insertPayload : [state.insertPayload!]
        inserted[table] = [...(inserted[table] ?? []), ...rows]
        if (table === 'deals') {
          return { data: { id: 'deal-1' }, error: null }
        }
        if (table === 'quotes') {
          const row = rows[0]
          return { data: { id: 'quote-1', ...row }, error: null }
        }
        if (table === 'quote_items') {
          return { data: rows.map((r, i) => ({ id: `item-${i + 1}`, ...r })), error: null }
        }
        return { data: null, error: null }
      }
      if (table === 'products') {
        return { data: fx.products ?? [], error: null }
      }
      if (table === 'product_price_options') {
        return { data: fx.priceOptions ?? [], error: null }
      }
      if (table === 'accounts') {
        return { data: { default_currency: fx.defaultCurrency ?? null }, error: null }
      }
      if (table === 'pipelines') {
        return { data: fx.pipeline ?? null, error: null }
      }
      if (table === 'pipeline_stages') {
        return { data: fx.stage ?? null, error: null }
      }
      if (table === 'deals') {
        return { data: fx.existingOpenDeal ?? null, error: null }
      }
      return { data: null, error: null }
    }

    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => resolve(),
      single: () => resolve(),
      insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        state.mode = 'insert'
        state.insertPayload = payload
        return b
      },
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    }
    return b
  }

  return {
    db: { from: (table: string) => builder(table) } as unknown as SupabaseClient,
    inserted,
  }
}

describe('createQuote — customer field validation', () => {
  it('rejects when a required customer field is missing', async () => {
    const { db } = makeDb({ pipeline: null })
    await expect(
      createQuote({
        db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1',
        ...CUSTOMER, customerNit: '', items: [{ product_id: 'p1', quantity: 1 }], allowFreeItems: true,
      }),
    ).rejects.toBeInstanceOf(CreateQuoteError)
  })

  it('rejects an empty item list', async () => {
    const { db } = makeDb({ pipeline: null })
    await expect(
      createQuote({ db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER, items: [], allowFreeItems: true }),
    ).rejects.toBeInstanceOf(CreateQuoteError)
  })
})

describe('createQuote — catalog vs free items', () => {
  it('rejects a free-form item when allowFreeItems is false (the AI path)', async () => {
    const { db } = makeDb({ pipeline: null })
    await expect(
      createQuote({
        db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
        items: [{ quantity: 1, description: 'Algo inventado', unit_price: 999 }],
        allowFreeItems: false,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('accepts a free-form item when allowFreeItems is true (the human path)', async () => {
    const { db, inserted } = makeDb({ pipeline: null })
    const { quote, items } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ quantity: 2, description: 'Servicio a medida', unit_price: 150 }],
      allowFreeItems: true,
    })
    expect(items).toHaveLength(1)
    expect(quote.subtotal).toBe(300)
    expect(quote.total).toBe(300)
    expect(inserted.quote_items[0]).toMatchObject({ product_id: null, description: 'Servicio a medida', unit_price: 150, quantity: 2, line_total: 300 })
  })

  it('rejects a product_id that does not exist in this account\'s catalog', async () => {
    const { db } = makeDb({ products: [], pipeline: null })
    await expect(
      createQuote({
        db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
        items: [{ product_id: 'ghost-product', quantity: 1 }],
        allowFreeItems: false,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('rejects an inactive product even when allowFreeItems is true', async () => {
    const { db } = makeDb({
      products: [{ id: 'p1', name: 'Descontinuado', price: 10, is_active: false }],
      pipeline: null,
    })
    await expect(
      createQuote({
        db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
        items: [{ product_id: 'p1', quantity: 1 }],
        allowFreeItems: true,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('always re-reads price and name from the product row, ignoring anything the caller might pass', async () => {
    const { db, inserted } = makeDb({
      products: [{ id: 'p1', name: 'Producto real', price: 42, is_active: true }],
      pipeline: null,
    })
    const { quote, items } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', quantity: 3 }],
      allowFreeItems: false,
    })
    expect(items[0]).toMatchObject({ description: 'Producto real', unit_price: 42, quantity: 3 })
    expect(quote.subtotal).toBe(126)
    expect(inserted.quote_items[0]).toMatchObject({ unit_price: 42, description: 'Producto real' })
  })

  it('computes subtotal/total across multiple mixed items', async () => {
    const { db } = makeDb({
      products: [{ id: 'p1', name: 'A', price: 10, is_active: true }],
      pipeline: null,
    })
    const { quote } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [
        { product_id: 'p1', quantity: 2 }, // 20
        { quantity: 1, description: 'Libre', unit_price: 30 }, // 30
      ],
      allowFreeItems: true,
    })
    expect(quote.subtotal).toBe(50)
    expect(quote.total).toBe(50)
  })

  it('rejects a non-positive quantity', async () => {
    const { db } = makeDb({ products: [{ id: 'p1', name: 'A', price: 10, is_active: true }], pipeline: null })
    await expect(
      createQuote({
        db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
        items: [{ product_id: 'p1', quantity: 0 }],
        allowFreeItems: false,
      }),
    ).rejects.toBeInstanceOf(CreateQuoteError)
  })
})

describe('createQuote — price options (migration 075)', () => {
  it('uses the price option\'s price instead of the product\'s base price', async () => {
    const { db, inserted } = makeDb({
      products: [{ id: 'p1', name: 'Silla', price: 100, is_active: true }],
      priceOptions: [{ id: 'opt1', product_id: 'p1', label: 'Talla XL', price: 150, installation_cost: null }],
      pipeline: null,
    })
    const { quote, items } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', price_option_id: 'opt1', quantity: 2 }],
      allowFreeItems: false,
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ unit_price: 150, description: 'Silla — Talla XL', product_price_option_id: 'opt1' })
    expect(quote.subtotal).toBe(300)
    expect(inserted.quote_items[0]).toMatchObject({ unit_price: 150, quantity: 2, product_price_option_id: 'opt1' })
  })

  it('adds a separate flat-fee installation line when the option has one', async () => {
    const { db, inserted } = makeDb({
      products: [{ id: 'p1', name: 'Silla', price: 100, is_active: true }],
      priceOptions: [{ id: 'opt1', product_id: 'p1', label: 'Talla XL', price: 150, installation_cost: 25 }],
      pipeline: null,
    })
    const { items, quote } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', price_option_id: 'opt1', quantity: 3 }],
      allowFreeItems: false,
    })
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ description: 'Instalación — Silla — Talla XL', unit_price: 25, quantity: 1 })
    // 3 * 150 (product) + 25 (flat installation, not multiplied by qty)
    expect(quote.subtotal).toBe(475)
    expect(inserted.quote_items).toHaveLength(2)
  })

  it('does not add an installation line when installation_cost is null or zero', async () => {
    const { db, inserted } = makeDb({
      products: [{ id: 'p1', name: 'Silla', price: 100, is_active: true }],
      priceOptions: [{ id: 'opt1', product_id: 'p1', label: 'Talla XL', price: 150, installation_cost: 0 }],
      pipeline: null,
    })
    const { items } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', price_option_id: 'opt1', quantity: 1 }],
      allowFreeItems: false,
    })
    expect(items).toHaveLength(1)
    expect(inserted.quote_items).toHaveLength(1)
  })

  it('adds an installation line from the product\'s own base installation_cost when no price option is selected (migration 076)', async () => {
    const { db } = makeDb({
      products: [{ id: 'p1', name: 'Silla', price: 100, installation_cost: 15, is_active: true }],
      pipeline: null,
    })
    const { items, quote } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', quantity: 2 }],
      allowFreeItems: false,
    })
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ description: 'Instalación — Silla', unit_price: 15, quantity: 1 })
    // 2 * 100 (product) + 15 (flat installation, not multiplied by qty)
    expect(quote.subtotal).toBe(215)
  })

  it('a selected price option\'s installation_cost overrides the product\'s own base installation_cost', async () => {
    const { db, inserted } = makeDb({
      products: [{ id: 'p1', name: 'Silla', price: 100, installation_cost: 15, is_active: true }],
      priceOptions: [{ id: 'opt1', product_id: 'p1', label: 'Talla XL', price: 150, installation_cost: 25 }],
      pipeline: null,
    })
    const { items } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', price_option_id: 'opt1', quantity: 1 }],
      allowFreeItems: false,
    })
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ unit_price: 25 })
    expect(inserted.quote_items).toHaveLength(2)
  })

  it('rejects a price_option_id that belongs to a different product', async () => {
    const { db } = makeDb({
      products: [
        { id: 'p1', name: 'Silla', price: 100, is_active: true },
        { id: 'p2', name: 'Mesa', price: 200, is_active: true },
      ],
      priceOptions: [{ id: 'opt1', product_id: 'p2', label: 'Grande', price: 250, installation_cost: null }],
      pipeline: null,
    })
    await expect(
      createQuote({
        db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
        items: [{ product_id: 'p1', price_option_id: 'opt1', quantity: 1 }],
        allowFreeItems: false,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('createQuote — linked deal', () => {
  it('creates a linked deal in the account\'s pipeline/first stage', async () => {
    const { db, inserted } = makeDb({
      products: [{ id: 'p1', name: 'A', price: 10, is_active: true }],
      pipeline: { id: 'pipe-1' },
      stage: { id: 'stage-1' },
    })
    const { quote } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', quantity: 1 }],
      allowFreeItems: false,
    })
    expect(quote.deal_id).toBe('deal-1')
    expect(inserted.deals[0]).toMatchObject({
      account_id: 'acct-1', pipeline_id: 'pipe-1', stage_id: 'stage-1',
      contact_id: 'contact-1', value: 10, status: 'open',
    })
  })

  it('reuses the contact\'s existing open deal instead of creating a second one', async () => {
    const { db, inserted } = makeDb({
      products: [{ id: 'p1', name: 'A', price: 10, is_active: true }],
      pipeline: { id: 'pipe-1' },
      stage: { id: 'stage-1' },
      existingOpenDeal: { id: 'existing-deal-1' },
    })
    const { quote } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', quantity: 1 }],
      allowFreeItems: false,
    })
    expect(quote.deal_id).toBe('existing-deal-1')
    expect(inserted.deals).toBeUndefined()
  })

  it('leaves deal_id null when the account has no pipeline yet, without failing the quote', async () => {
    const { db } = makeDb({
      products: [{ id: 'p1', name: 'A', price: 10, is_active: true }],
      pipeline: null,
    })
    const { quote } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', quantity: 1 }],
      allowFreeItems: false,
    })
    expect(quote.deal_id).toBeNull()
  })
})

describe('createQuote — currency', () => {
  it('uses the account default_currency when set', async () => {
    const { db } = makeDb({
      products: [{ id: 'p1', name: 'A', price: 10, is_active: true }],
      defaultCurrency: 'GTQ',
      pipeline: null,
    })
    const { quote } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', quantity: 1 }],
      allowFreeItems: false,
    })
    expect(quote.currency).toBe('GTQ')
  })

  it('falls back to USD when the account has no default_currency', async () => {
    const { db } = makeDb({
      products: [{ id: 'p1', name: 'A', price: 10, is_active: true }],
      defaultCurrency: null,
      pipeline: null,
    })
    const { quote } = await createQuote({
      db, accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', ...CUSTOMER,
      items: [{ product_id: 'p1', quantity: 1 }],
      allowFreeItems: false,
    })
    expect(quote.currency).toBe('USD')
  })
})
