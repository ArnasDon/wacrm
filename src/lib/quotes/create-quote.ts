import type { SupabaseClient } from '@supabase/supabase-js'
import type { Quote, QuoteItem } from '@/types'

export class CreateQuoteError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'CreateQuoteError'
  }
}

/** Bounds on a single quote — the public "Me lo llevo" form and the AI
 *  both feed this, so an out-of-range payload should be a clean 400,
 *  not a quote/deal with an absurd total polluting pipeline reporting. */
const MAX_QUOTE_ITEMS = 100
const MAX_ITEM_QUANTITY = 100_000

/** Round a currency amount to 2 decimals — `unit_price * quantity`
 *  summed in floating point drifts (0.1 + 0.2 …), and these values are
 *  persisted and shown to customers. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
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
  /** Optional (migration 082) — no company is required to collect a
   *  customer's tax ID/email for a quote. An empty/missing value is
   *  stored as null, never as an empty string. */
  customerNit?: string | null
  customerEmail?: string | null
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

  // NIT/email are optional (migration 082, product decision 2026-08-25)
  // — each company decides for itself whether it wants them, via
  // ai_configs.ask_customer_tax_info for the AI's chat-quote flow.
  // Phone and address stay required: a quote with no way to deliver it
  // or ship the order isn't useful to anyone.
  if (!customerPhone?.trim() || !customerAddress?.trim()) {
    throw new CreateQuoteError('customerPhone and customerAddress are required')
  }
  const normalizedNit = customerNit?.trim() || null
  const normalizedEmail = customerEmail?.trim() || null
  if (!items || items.length === 0) {
    throw new CreateQuoteError('At least one item is required')
  }
  if (items.length > MAX_QUOTE_ITEMS) {
    throw new CreateQuoteError(`A quote can have at most ${MAX_QUOTE_ITEMS} items`)
  }

  const productIds = [...new Set(items.filter((i) => i.product_id).map((i) => i.product_id as string))]
  const productsById = new Map<string, { id: string; name: string; price: number; installation_cost: number | null; is_active: boolean }>()
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await db
      .from('products')
      .select('id, name, price, installation_cost, is_active')
      .eq('account_id', accountId)
      .in('id', productIds)
    if (productsError) throw new CreateQuoteError(productsError.message, 500)
    for (const p of products ?? []) productsById.set(p.id as string, p as { id: string; name: string; price: number; installation_cost: number | null; is_active: boolean })
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
    if (quantity > MAX_ITEM_QUANTITY) {
      throw new CreateQuoteError(`Item quantity cannot exceed ${MAX_ITEM_QUANTITY}`)
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

      // Installation is a flat fee, not multiplied by quantity — a
      // separate, clearly-labeled line rather than folded silently into
      // unit_price, so the customer sees exactly what they're paying
      // for. Comes from the selected option when there is one, or from
      // the product's own base installation_cost (migration 076)
      // otherwise.
      const installationCost = optionId
        ? priceOptionsById.get(optionId)!.installation_cost
        : product.installation_cost
      if (installationCost != null && installationCost > 0) {
        resolvedItems.push({
          description: `Instalación — ${description}`,
          unit_price: installationCost,
          quantity: 1,
          product_id: null,
          product_price_option_id: optionId,
        })
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

  const subtotal = round2(
    resolvedItems.reduce((sum, i) => sum + round2(i.unit_price * i.quantity), 0),
  )
  const total = subtotal

  const { data: account } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', accountId)
    .maybeSingle()
  const currency = account?.default_currency ?? 'USD'

  // Reuse the contact's existing open deal instead of always creating a
  // new one — real bug hit in production (2026-08-21): every quote used
  // to create its own deal unconditionally, so a contact who already had
  // an open deal (e.g. one the AI's autonomous stage progression had
  // already moved to "Cotización") ended up with a SECOND, disconnected
  // deal parked in the pipeline's first stage the moment a quote was
  // generated for them — same contact showing twice in Pipelines and in
  // the inbox's linked-deal panel. Same resolution `autoMoveDealStage`
  // (src/lib/ai/auto-reply.ts) and the automations engine's `move_deal`
  // step already use: the contact's most-recently-updated open deal.
  let dealId: string | null = null
  const { data: existingDeal } = await db
    .from('deals')
    .select('id, value')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingDeal) {
    dealId = existingDeal.id as string
    // Seed the deal's value from this quote when it has never been
    // priced (0 / null — e.g. a deal the AI's autonomous stage
    // progression created with `value: 0`). A value a human already
    // set is left alone: re-pricing an existing deal from every new
    // quote would fight manual edits.
    const currentValue = Number(existingDeal.value ?? 0)
    if (!Number.isFinite(currentValue) || currentValue === 0) {
      await db
        .from('deals')
        .update({ value: total })
        .eq('id', dealId)
        .eq('account_id', accountId)
    }
  } else {
    // No open deal yet — land a brand-new one in the account's oldest
    // pipeline, first stage. There's no "default pipeline" concept
    // elsewhere in the app to defer to, so this mirrors "a brand-new
    // deal starts at the top of the board." Degrades gracefully
    // (deal_id stays null) if the account has no pipeline/stage set up
    // yet — that must never block the quote itself from being created.
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
  }

  const { data: quote, error: quoteError } = await db
    .from('quotes')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      deal_id: dealId,
      customer_nit: normalizedNit,
      customer_email: normalizedEmail,
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
    line_total: round2(item.unit_price * item.quantity),
    position: index,
  }))
  const { data: insertedItems, error: itemsError } = await db
    .from('quote_items')
    .insert(itemRows)
    .select('*')
  if (itemsError) throw new CreateQuoteError(itemsError.message, 500)

  return { quote: quote as Quote, items: (insertedItems ?? []) as QuoteItem[] }
}
