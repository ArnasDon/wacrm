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
 * Prefetch is intentionally NOT a catalogue answer source.
 *
 * It only tells the model that the current turn is catalogue-related and
 * which concise query was successful. Product names/prices are deliberately
 * omitted so the model cannot bypass search_catalog and fall back to an old
 * numbered text list. search_catalog owns current product data and, in visual
 * mode, queues the WhatsApp photographs + interactive selection buttons.
 */
export function cataloguePrefetchPrompt(result: CataloguePrefetchResult): string | null {
  if (!result.attempted) return null

  const selectionInstruction = result.selection
    ? [
        `The customer's latest numeric reply selected option ${result.selection.number} from a legacy numbered product list.`,
        `The selected product name is exactly: ${JSON.stringify(result.selection.productName)}.`,
        'Keep this selection fixed and migrate the interaction to the visual catalogue tools.',
        ...(result.selection.photoChoice
          ? [
              'This selection is already a request for that product photograph.',
              'Call search_catalog with the exact selected product name and then call send_product with the best exact-name result that has a photograph. Do not ask for confirmation again.',
            ]
          : [
              'If a catalogue response is required, call search_catalog with this exact product name rather than quoting an older list.',
            ]),
      ]
    : []

  if (result.products.length === 0) {
    return [
      'CATALOGUE TOOL ROUTING:',
      ...selectionInstruction,
      `A server-side intent check for ${JSON.stringify(result.query ?? '')} did not find a result.`,
      'Do not assume the catalogue is empty. Call search_catalog with a concise product term before concluding that nothing is available.',
      'Never reconstruct or repeat an older numbered product list from conversation history.',
    ].join('\n')
  }

  const withPhotos = result.products.filter((product) =>
    Boolean(product.imageUrl || product.variants?.some((variant) => variant.imageUrl)),
  ).length

  return [
    'CATALOGUE TOOL ROUTING — PRODUCT INTENT DETECTED:',
    ...selectionInstruction,
    `A server-side intent check found ${result.products.length} possible current result(s) for query ${JSON.stringify(result.query ?? '')}; ${withPhotos} have a directly resolvable photograph at this stage.`,
    'You MUST call search_catalog before answering with product names, prices, availability or recommendations.',
    'For browsing/recommendation requests, call search_catalog with visual=true (or omit visual, since true is the default). The server will queue photographs and clickable WhatsApp selection buttons.',
    'When visual_queued=true, do NOT reproduce product names/prices as bullets or numbered text. Reply only with a very short introduction such as "Veja estas opções:".',
    'Never ask the customer to type a number or product name when interactive product buttons are available.',
  ].join('\n')
}
