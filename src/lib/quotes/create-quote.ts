import type { SupabaseClient } from '@supabase/supabase-js'
import type { Quote, QuoteItem } from '@/types'

export class CreateQuoteError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'CreateQuoteError'
  }
}

export interface QuoteItemInput {
  /** Present = catalog product (price/name always re-read from `products`,
   *  never trusted from the caller). Absent = free-form item, only
   *  accepted when `allowFreeItems` is true. */
  product_id?: string | null
  /** Optional priced variant of `product_id` (migration 075) — when
   *  given, its `price` replaces the product's base price for this
   *  line, and its `installation_cost` (if any) adds a second,
   *  server-synthesized line right after it. Always re-read from
   *  `product_price_options`, never trusted from the caller. Ignored
   *  for a free-form item. */
  price_option_id?: string | null
  quantity: number
  /** Free-item only. Ignored for a catalog item. */
  description?: string
  /** Free-item only. Ignored for a catalog item. */
  unit_price?: number
}

export interface CreateQuoteArgs {
  db: SupabaseClient
  accountId: string
  userId: string
  contactId: string
  customerNit: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  items: QuoteItemInput[]
  /** true for the human quote-builder route; false for the AI's
   *  `create_quote` business action — the AI may only ever reference
   *  existing catalog products, never invent a price. */
  allowFreeItems: boolean
}

export interface CreatedQuote {
  quote: Quote
  items: QuoteItem[]
}

/**
 * Shared core for both quote-creation entry points (human quote builder,
 * AI `create_quote` action). Resolves each item's price server-side —
 * a catalog item's price always comes from the current `products` row,
 * never from the caller — computes totals, persists `quotes` +
 * `quote_items`, and creates a linked `deal` (account's oldest pipeline,
 * its first stage) so the quote shows up in the sales pipeline like any
 * other deal.
 */
export async function createQuote(args: CreateQuoteArgs): Promise<CreatedQuote> {
  const {
    db, accountId, userId, contactId,
    customerNit, customerEmail, customerPhone, customerAddress,
    items, allowFreeItems,
  } = args

  if (!customerNit?.trim() || !customerEmail?.trim() || !customerPhone?.trim() || !customerAddress?.trim()) {
    throw new CreateQuoteError('customerNit, customerEmail, customerPhone, and customerAddress are all required')
  }
  if (!items || items.length === 0) {
    throw new CreateQuoteError('At least one item is required')
  }

  const productIds = [...new Set(items.filter((i) => i.product_id).map((i) => i.product_id as string))]
  const productsById = new Map<string, { id: string; name: string; price: number; is_active: boolean }>()
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await db
      .from('products')
      .select('id, name, price, is_active')
      .eq('account_id', accountId)
      .in('id', productIds)
    if (productsError) throw new CreateQuoteError(productsError.message, 500)
    for (const p of products ?? []) productsById.set(p.id as string, p as { id: string; name: string; price: number; is_active: boolean })
  }

  const priceOptionIds = [...new Set(items.filter((i) => i.price_option_id).map((i) => i.price_option_id as string))]
  const priceOptionsById = new Map<string, { id: string; product_id: string; label: string; price: number; installation_cost: number | null }>()
  if (priceOptionIds.length > 0) {
    const { data: options, error: optionsError } = await db
      .from('product_price_options')
      .select('id, product_id, label, price, installation_cost')
      .eq('account_id', accountId)
      .in('id', priceOptionIds)
    if (optionsError) throw new CreateQuoteError(optionsError.message, 500)
    for (const o of options ?? []) {
      priceOptionsById.set(o.id as string, o as { id: string; product_id: string; label: string; price: number; installation_cost: number | null })
    }
  }

  const resolvedItems: { description: string; unit_price: number; quantity: number; product_id: string | null; product_price_option_id: string | null }[] = []
  for (const raw of items) {
    const quantity = Number(raw.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new CreateQuoteError('Each item needs a positive quantity')
    }
    if (raw.product_id) {
      const product = productsById.get(raw.product_id)
      if (!product || !product.is_active) {
        throw new CreateQuoteError(`Product ${raw.product_id} not found in this account's catalog, or inactive`, 404)
      }

      let unitPrice = product.price
      let description = product.name
      let optionId: string | null = null
      if (raw.price_option_id) {
        const option = priceOptionsById.get(raw.price_option_id)
        if (!option || option.product_id !== raw.product_id) {
          throw new CreateQuoteError(`Price option ${raw.price_option_id} not found for product ${raw.product_id}`, 404)
        }
        unitPrice = option.price
        description = `${product.name} — ${option.label}`
        optionId = option.id
      }

      resolvedItems.push({ description, unit_price: unitPrice, quantity, product_id: product.id, product_price_option_id: optionId })

      // Installation is a flat fee for the option, not multiplied by
      // quantity — a separate, clearly-labeled line rather than folded
      // silently into unit_price, so the customer sees exactly what
      // they're paying for.
      if (optionId) {
        const option = priceOptionsById.get(optionId)!
        if (option.installation_cost != null && option.installation_cost > 0) {
          resolvedItems.push({
            description: `Instalación — ${description}`,
            unit_price: option.installation_cost,
            quantity: 1,
            product_id: null,
            product_price_option_id: optionId,
          })
        }
      }
    } else {
      if (!allowFreeItems) {
        throw new CreateQuoteError('Items must reference a catalog product (product_id)')
      }
      const description = raw.description?.trim()
      const unitPrice = Number(raw.unit_price)
      if (!description) throw new CreateQuoteError('A free-form item needs a description')
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new CreateQuoteError('A free-form item needs a valid unit_price')
      resolvedItems.push({ description, unit_price: unitPrice, quantity, product_id: null, product_price_option_id: null })
    }
  }

  const subtotal = resolvedItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
  const total = subtotal

  const { data: account } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', accountId)
    .maybeSingle()
  const currency = account?.default_currency ?? 'USD'

  // Land the linked deal in the account's oldest pipeline, first stage —
  // there's no "default pipeline" concept elsewhere in the app to defer
  // to, so this mirrors "a brand-new deal starts at the top of the
  // board." Degrades gracefully (deal_id stays null) if the account has
  // no pipeline/stage set up yet — that must never block the quote
  // itself from being created.
  let dealId: string | null = null
  const { data: pipeline } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (pipeline) {
    const { data: stage } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipeline.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (stage) {
      const { data: deal, error: dealError } = await db
        .from('deals')
        .insert({
          account_id: accountId,
          user_id: userId,
          pipeline_id: pipeline.id,
          stage_id: stage.id,
          contact_id: contactId,
          title: `Cotización — ${new Date().toISOString().slice(0, 10)}`,
          value: total,
          currency,
          status: 'open',
        })
        .select('id')
        .single()
      if (dealError) throw new CreateQuoteError(dealError.message, 500)
      dealId = deal.id as string
    }
  }

  const { data: quote, error: quoteError } = await db
    .from('quotes')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      deal_id: dealId,
      customer_nit: customerNit.trim(),
      customer_email: customerEmail.trim(),
      customer_phone: customerPhone.trim(),
      customer_address: customerAddress.trim(),
      currency,
      subtotal,
      total,
      status: 'draft',
    })
    .select('*')
    .single()
  if (quoteError) throw new CreateQuoteError(quoteError.message, 500)

  const itemRows = resolvedItems.map((item, index) => ({
    account_id: accountId,
    quote_id: quote.id,
    product_id: item.product_id,
    product_price_option_id: item.product_price_option_id,
    description: item.description,
    unit_price: item.unit_price,
    quantity: item.quantity,
    line_total: item.unit_price * item.quantity,
    position: index,
  }))
  const { data: insertedItems, error: itemsError } = await db
    .from('quote_items')
    .insert(itemRows)
    .select('*')
  if (itemsError) throw new CreateQuoteError(itemsError.message, 500)

  return { quote: quote as Quote, items: (insertedItems ?? []) as QuoteItem[] }
}
