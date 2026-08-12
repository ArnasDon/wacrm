import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export interface ConversationCatalogState {
  lastQuery: string | null
  lastFilters: Record<string, unknown>
  shownProductKeys: string[]
  shownMediaKeys: string[]
  rejectedProductKeys: string[]
  selectedProductKey: string | null
  selectedProductName: string | null
}

const EMPTY_STATE: ConversationCatalogState = {
  lastQuery: null,
  lastFilters: {},
  shownProductKeys: [],
  shownMediaKeys: [],
  rejectedProductKeys: [],
  selectedProductKey: null,
  selectedProductName: null,
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function mergeUnique(current: string[], additions: string[]): string[] {
  return Array.from(new Set([...current, ...additions])).slice(-500)
}

function safeFilterText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 120) : null
}

/**
 * Small operational context block for the model. Product keys and media keys
 * stay server-side; the model only needs the human-readable selected product
 * and last structured search constraints to resolve "mais", "esta", "M?",
 * etc. This is current-conversation state, not durable customer memory.
 */
export function conversationCatalogStatePrompt(
  state: ConversationCatalogState,
): string | null {
  const category = safeFilterText(state.lastFilters.category)
  const color = safeFilterText(state.lastFilters.color)
  const size = safeFilterText(state.lastFilters.size)
  const hasContext = Boolean(
    state.selectedProductName || state.lastQuery || category || color || size,
  )
  if (!hasContext) return null

  const lines = [
    'Current catalogue conversation state — operational context from this WhatsApp conversation, not long-term customer memory.',
  ]
  if (state.selectedProductName) {
    lines.push(`Selected/current product: ${JSON.stringify(state.selectedProductName)}.`)
  }
  if (state.lastQuery) lines.push(`Last catalogue query: ${JSON.stringify(state.lastQuery)}.`)
  const filters = [
    category ? `category=${JSON.stringify(category)}` : null,
    color ? `color=${JSON.stringify(color)}` : null,
    size ? `size=${JSON.stringify(size)}` : null,
  ].filter(Boolean)
  if (filters.length > 0) lines.push(`Last explicit filters: ${filters.join(', ')}.`)
  if (state.shownProductKeys.length > 0) {
    lines.push(
      `${state.shownProductKeys.length} product(s) have already been shown in this conversation; browse-mode catalogue search excludes them server-side.`,
    )
  }
  lines.push(
    'Use this only to preserve continuity. For "more/other" keep relevant previous constraints and browse for unseen products; for questions about the selected/current product use lookup mode. Do not mention this internal state to the customer.',
  )
  return lines.join('\n')
}

export async function loadConversationCatalogState(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
}): Promise<ConversationCatalogState> {
  if (!args.conversationId) return { ...EMPTY_STATE }
  try {
    const { data, error } = await args.db
      .from('conversation_catalog_state')
      .select(
        'last_query, last_filters, shown_product_keys, shown_media_keys, rejected_product_keys, selected_product_key, selected_product_name',
      )
      .eq('account_id', args.accountId)
      .eq('conversation_id', args.conversationId)
      .maybeSingle()
    if (error) {
      console.warn('[catalog state] load failed; continuing stateless:', error.message)
      return { ...EMPTY_STATE }
    }
    if (!data) return { ...EMPTY_STATE }
    return {
      lastQuery: typeof data.last_query === 'string' ? data.last_query : null,
      lastFilters: asObject(data.last_filters),
      shownProductKeys: asStringArray(data.shown_product_keys),
      shownMediaKeys: asStringArray(data.shown_media_keys),
      rejectedProductKeys: asStringArray(data.rejected_product_keys),
      selectedProductKey:
        typeof data.selected_product_key === 'string' ? data.selected_product_key : null,
      selectedProductName:
        typeof data.selected_product_name === 'string' ? data.selected_product_name : null,
    }
  } catch (error) {
    console.warn('[catalog state] load failed; continuing stateless:', error)
    return { ...EMPTY_STATE }
  }
}

async function upsertState(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  state: ConversationCatalogState
}): Promise<void> {
  if (!args.conversationId) return
  try {
    const { error } = await args.db.from('conversation_catalog_state').upsert(
      {
        account_id: args.accountId,
        conversation_id: args.conversationId,
        last_query: args.state.lastQuery,
        last_filters: args.state.lastFilters,
        shown_product_keys: args.state.shownProductKeys,
        shown_media_keys: args.state.shownMediaKeys,
        rejected_product_keys: args.state.rejectedProductKeys,
        selected_product_key: args.state.selectedProductKey,
        selected_product_name: args.state.selectedProductName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,conversation_id' },
    )
    if (error) console.warn('[catalog state] save failed:', error.message)
  } catch (error) {
    console.warn('[catalog state] save failed:', error)
  }
}

export async function rememberCatalogSearch(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  query: string
  filters: Record<string, unknown>
}): Promise<void> {
  const state = await loadConversationCatalogState(args)
  state.lastQuery = args.query
  state.lastFilters = args.filters
  await upsertState({ ...args, state })
}

export async function rememberProductsShown(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  productKeys: string[]
  mediaKeys: string[]
}): Promise<void> {
  if (!args.productKeys.length && !args.mediaKeys.length) return
  const state = await loadConversationCatalogState(args)
  state.shownProductKeys = mergeUnique(state.shownProductKeys, args.productKeys)
  state.shownMediaKeys = mergeUnique(state.shownMediaKeys, args.mediaKeys)
  await upsertState({ ...args, state })
}

export async function rememberSelectedProduct(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  productKey: string
  productName: string
}): Promise<void> {
  const state = await loadConversationCatalogState(args)
  state.selectedProductKey = args.productKey
  state.selectedProductName = args.productName
  await upsertState({ ...args, state })
}
