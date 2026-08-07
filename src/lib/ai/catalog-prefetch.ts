import { searchCatalogues } from '@/lib/catalog/search'
import type { CatalogProduct } from '@/lib/catalog/types'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { ChatMessage } from './types'

const PRODUCT_INTENT_RE =
  /\b(pre[cç]o|pre[cç]os|custa|custam|quanto|tem|tens|t[eê]m|dispon[ií]vel|disponibilidade|stock|estoque|cat[aá]logo|produto|produtos|modelo|modelos|tamanho|tamanhos|cor|cores|foto|fotos|imagem|imagens|quero|procuro|procurando|mostra|mostrar|manda|enviar|op[cç][aã]o|op[cç][oõ]es)\b/i

const SHORT_CONTINUATION_RE =
  /^(sim|sim por ?favor|por ?favor|quero|pode|podes|mostra|manda|envia|ent[aã]o|e agora|agora|ok|okay|certo|isso|esse|essa|este|esta)[.!? ]*$/i

const CATALOGUE_CONTEXT_RE =
  /\b(cat[aá]logo|produto|produtos|pre[cç]o|pre[cç]os|stock|estoque|dispon[ií]vel|disponibilidade|modelo|modelos|op[cç][aã]o|op[cç][oõ]es|foto|imagem)\b/i

function isLikelyProductTurn(messages: ChatMessage[]): boolean {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  if (!latestUser) return false
  if (PRODUCT_INTENT_RE.test(latestUser.content)) return true

  if (!SHORT_CONTINUATION_RE.test(latestUser.content.trim())) return false
  return [...messages]
    .reverse()
    .slice(0, 6)
    .some(
      (message) =>
        message.role === 'assistant' && CATALOGUE_CONTEXT_RE.test(message.content),
    )
}

function candidateQueries(messages: ChatMessage[]): string[] {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .reverse()

  const queries: string[] = []
  for (const value of userMessages) {
    if (SHORT_CONTINUATION_RE.test(value) && queries.length === 0) continue
    if (!queries.includes(value)) queries.push(value)
    if (queries.length >= 3) break
  }

  // If every recent user message was only a continuation, retain the latest
  // one as a last-resort query rather than returning an empty list.
  if (queries.length === 0 && userMessages[0]) queries.push(userMessages[0])
  return queries
}

export interface CataloguePrefetchResult {
  attempted: boolean
  query: string | null
  products: CatalogProduct[]
}

export async function prefetchCatalogueForConversation(args: {
  db: WacrmSupabaseClient
  accountId: string
  messages: ChatMessage[]
  limit?: number
}): Promise<CataloguePrefetchResult> {
  const { db, accountId, messages, limit = 5 } = args
  if (!isLikelyProductTurn(messages)) {
    return { attempted: false, query: null, products: [] }
  }

  const queries = candidateQueries(messages)
  for (const query of queries) {
    try {
      const products = await searchCatalogues(db, accountId, { query, limit })
      if (products.length > 0) {
        return { attempted: true, query, products }
      }
    } catch (error) {
      console.error('[ai catalogue prefetch] search failed:', {
        query,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { attempted: true, query: queries[0] ?? null, products: [] }
}

export function cataloguePrefetchPrompt(result: CataloguePrefetchResult): string | null {
  if (!result.attempted) return null

  if (result.products.length === 0) {
    return [
      'CATALOGUE GROUNDING:',
      `A server-side catalogue pre-search for ${JSON.stringify(result.query ?? '')} returned no products.`,
      'Do not assume the catalogue is empty. If the customer is asking about a product, use search_catalog with a concise product term before concluding that nothing is available.',
    ].join('\n')
  }

  const products = result.products.map((product) => ({
    name: product.name,
    description: product.description,
    price: product.price,
    currency: product.currency,
    category: product.category,
    stock_quantity: product.stockQuantity,
    has_photo: Boolean(product.imageUrl),
    source: product.sourceName,
  }))

  return [
    'CATALOGUE GROUNDING — CURRENT SERVER RESULTS:',
    `Query used: ${JSON.stringify(result.query ?? '')}`,
    JSON.stringify(products),
    'These results are authoritative for names, prices and stock in this turn. Answer directly from them when relevant.',
    'If the customer asks for a photograph, still call search_catalog followed by send_product so the server can create and validate the temporary product_ref.',
  ].join('\n')
}
