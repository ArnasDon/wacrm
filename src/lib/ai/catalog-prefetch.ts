import { searchCatalogues } from '@/lib/catalog/search'
import type { CatalogProduct } from '@/lib/catalog/types'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { chatContentText, type ChatMessage } from './types'

const PRODUCT_INTENT_RE =
  /\b(pre[cç]o|pre[cç]os|custa|custam|quanto|tem|tens|t[eê]m|dispon[ií]vel|disponibilidade|stock|estoque|cat[aá]logo|produto|produtos|modelo|modelos|tamanho|tamanhos|cor|cores|foto|fotos|imagem|imagens|quero|procuro|procurando|mostra|mostrar|manda|enviar|op[cç][aã]o|op[cç][oõ]es)\b/i

const SHORT_CONTINUATION_RE =
  /^(sim|sim por ?favor|por ?favor|quero|pode|podes|mostra|manda|envia|ent[aã]o|e agora|agora|ok|okay|certo|isso|esse|essa|este|esta)[.!? ]*$/i

const NUMBER_SELECTION_RE = /^\s*(\d{1,2})\s*[.!?]?\s*$/

const CATALOGUE_CONTEXT_RE =
  /\b(cat[aá]logo|produto|produtos|pre[cç]o|pre[cç]os|stock|estoque|dispon[ií]vel|disponibilidade|modelo|modelos|op[cç][aã]o|op[cç][oõ]es|foto|imagem)\b/i

const PHOTO_CHOICE_RE =
  /\b(foto|fotografia|imagem|envio|enviar|envie|manda|mandar|mostra|mostrar)\b/i

interface NumberedSelection {
  number: number
  productName: string
  photoChoice: boolean
}

function cleanNumberedProductLabel(value: string): string {
  return value
    .replace(/\s+[—–-]\s+[\d.,]+\s*(?:MT|MZN)\b.*$/i, '')
    .replace(/\s+\([\d.,]+\s*(?:MT|MZN)\).*$/i, '')
    .trim()
}

function numberedProducts(content: string): Map<number, string> {
  const products = new Map<number, string>()
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{1,2})[.)]\s+(.+?)\s*$/)
    if (!match) continue
    const number = Number(match[1])
    const productName = cleanNumberedProductLabel(match[2])
    if (number > 0 && productName) products.set(number, productName)
  }
  return products
}

function resolveNumberedSelection(messages: ChatMessage[]): NumberedSelection | null {
  const latestUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === 'user')?.index
  if (latestUserIndex === undefined) return null

  const latestUser = messages[latestUserIndex]
  const latestUserText = chatContentText(latestUser.content)
  const selectionMatch = latestUserText.match(NUMBER_SELECTION_RE)
  if (!selectionMatch) return null
  const number = Number(selectionMatch[1])
  if (!Number.isInteger(number) || number < 1) return null

  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const messageText = chatContentText(message.content)
    const products = numberedProducts(messageText)
    const productName = products.get(number)
    if (productName) {
      return {
        number,
        productName,
        photoChoice: PHOTO_CHOICE_RE.test(messageText),
      }
    }
  }

  return null
}

function hasRecentCatalogueContext(messages: ChatMessage[]): boolean {
  return [...messages]
    .reverse()
    .slice(0, 8)
    .some(
      (message) =>
        message.role === 'assistant' &&
        (CATALOGUE_CONTEXT_RE.test(chatContentText(message.content)) ||
          numberedProducts(chatContentText(message.content)).size > 0),
    )
}

function isLikelyProductTurn(messages: ChatMessage[]): boolean {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  if (!latestUser) return false
  const latestUserText = chatContentText(latestUser.content)
  if (PRODUCT_INTENT_RE.test(latestUserText)) return true

  if (NUMBER_SELECTION_RE.test(latestUserText.trim())) {
    return Boolean(resolveNumberedSelection(messages))
  }

  if (!SHORT_CONTINUATION_RE.test(latestUserText.trim())) return false
  return hasRecentCatalogueContext(messages)
}

function candidateQueries(messages: ChatMessage[]): string[] {
  const selection = resolveNumberedSelection(messages)
  if (selection) return [selection.productName]

  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => chatContentText(message.content).trim())
    .filter(Boolean)
    .reverse()

  const queries: string[] = []
  for (const value of userMessages) {
    if (
      (SHORT_CONTINUATION_RE.test(value) || NUMBER_SELECTION_RE.test(value)) &&
      queries.length === 0
    )
      continue
    if (!queries.includes(value)) queries.push(value)
    if (queries.length >= 3) break
  }

  if (queries.length === 0 && userMessages[0]) queries.push(userMessages[0])
  return queries
}

export interface CataloguePrefetchResult {
  attempted: boolean
  query: string | null
  products: CatalogProduct[]
  selection: NumberedSelection | null
}

export async function prefetchCatalogueForConversation(args: {
  db: WacrmSupabaseClient
  accountId: string
  messages: ChatMessage[]
  limit?: number
}): Promise<CataloguePrefetchResult> {
  const { db, accountId, messages, limit = 5 } = args
  const selection = resolveNumberedSelection(messages)
  if (!isLikelyProductTurn(messages)) {
    return { attempted: false, query: null, products: [], selection: null }
  }

  const queries = candidateQueries(messages)
  for (const query of queries) {
    try {
      const products = await searchCatalogues(db, accountId, { query, limit })
      if (products.length > 0) {
        return { attempted: true, query, products, selection }
      }
    } catch (error) {
      console.error('[ai catalogue prefetch] search failed:', {
        query,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    attempted: true,
    query: queries[0] ?? null,
    products: [],
    selection,
  }
}

/**
 * Prefetch is advisory only. It helps recover very short/legacy continuations
 * before the model runs, but it never selects a skill/tool and never becomes
 * a catalogue answer source. Product data must still come from search_catalog.
 */
export function cataloguePrefetchPrompt(result: CataloguePrefetchResult): string | null {
  if (!result.attempted) return null

  const selectionInstruction = result.selection
    ? [
        `The customer's latest numeric reply selected option ${result.selection.number} from a legacy numbered product list.`,
        `The selected product name is exactly: ${JSON.stringify(result.selection.productName)}.`,
        'Keep that product as the current referent instead of restarting discovery.',
        ...(result.selection.photoChoice
          ? [
              'The customer is already asking to see that specific product. If a fresh catalogue reference is needed, search it with mode=lookup and then use send_product.',
            ]
          : [
              'If fresh product data is needed, search that exact product with mode=lookup rather than reconstructing an older list.',
            ]),
      ]
    : []

  if (result.products.length === 0) {
    return [
      'CATALOGUE CONTEXT (advisory):',
      ...selectionInstruction,
      `A lightweight prefetch for ${JSON.stringify(result.query ?? '')} found no candidate.`,
      'This is not proof that the catalogue is empty. Use search_catalog if current product data is needed, with concise structured category/colour/size constraints when the customer supplied them.',
      'Never reconstruct an old numbered product list from history.',
    ].join('\n')
  }

  return [
    'CATALOGUE CONTEXT (advisory):',
    ...selectionInstruction,
    `A lightweight prefetch found possible catalogue data for ${JSON.stringify(result.query ?? '')}.`,
    'Decide yourself whether a catalogue lookup is useful for this turn. search_catalog is retrieval-only and never sends a product automatically.',
    'When searching, pass explicit category/colour/size constraints separately instead of embedding every customer word in one broad query.',
    'After search_catalog, call send_product only for the products you deliberately choose to show. For "more/other" requests use browse mode; for a specific previously shown product use lookup mode.',
  ].join('\n')
}
