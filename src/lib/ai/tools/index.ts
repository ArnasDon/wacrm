import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { buildCatalogueMediaProxyUrl } from '@/lib/catalog/media-proxy'
import { searchCatalogues } from '@/lib/catalog/search'
import type { CatalogProduct } from '@/lib/catalog/types'
import { engineSendMedia } from '@/lib/flows/meta-send'
import { retrieveKnowledge } from '../knowledge'
import type { AgentToolKey } from '../tool-permissions'
import type {
  AgentToolDefinition,
  AgentToolExecutor,
  AiConfig,
} from '../types'

interface PendingProductSend {
  productRef: string
  name: string
  imageUrl: string
  displayImageUrl: string
  caption: string
}

interface PendingProductGallery {
  items: PendingProductSend[]
}

interface ToolSet {
  tools: AgentToolDefinition[]
  executeTool: AgentToolExecutor
  dispatchPendingActions: () => Promise<number>
  hasPendingActions: () => boolean
}

const SEARCH_KNOWLEDGE_TOOL: AgentToolDefinition = {
  name: 'search_knowledge',
  description:
    'Search the company knowledge base for services, policies or factual information. Use this when the customer asks about the company and no structured catalogue search is needed.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'A concise search query.' },
      limit: { type: 'integer', minimum: 1, maximum: 5 },
    },
    required: ['query'],
  },
}

const SEARCH_CATALOG_TOOL: AgentToolDefinition = {
  name: 'search_catalog',
  description:
    'Search all active product catalogues. Returns real names, prices, photos, links, stock and a temporary product_ref. For discovery, browsing or comparison requests, set visual=true so the server presents up to three products as visual WhatsApp product cards instead of making you write a numbered text list. For a precise lookup or when you only need data, omit visual or set it false. When the customer selected an item from prior context, search the exact selected product name rather than a number.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {
        type: 'string',
        description: 'Product name, category, colour, size or customer need.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: 'Maximum number of products to return.',
      },
      visual: {
        type: 'boolean',
        description:
          'Set true when the customer wants to browse, compare or see several product options. The server will send visual product cards with photo and price.',
      },
    },
    required: ['query'],
  },
}

const SEND_PRODUCT_TOOL: AgentToolDefinition = {
  name: 'send_product',
  description:
    'Prepare the WhatsApp delivery of one product photo returned by search_catalog. Call this when the customer explicitly asks to receive or see one specific product. Use the exact temporary product_ref; never pass a URL. If several search results represent the same product, prefer the exact-name result that has a photograph.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      product_ref: {
        type: 'string',
        description: 'The exact temporary product_ref returned by search_catalog.',
      },
    },
    required: ['product_ref'],
  },
}

const TOOL_DEFINITIONS: Record<AgentToolKey, AgentToolDefinition> = {
  search_catalog: SEARCH_CATALOG_TOOL,
  send_product: SEND_PRODUCT_TOOL,
  search_knowledge: SEARCH_KNOWLEDGE_TOOL,
}

function parseObject(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Tool arguments are not valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be a JSON object.')
  }
  return value as Record<string, unknown>
}

function parseSearchInput(input: Record<string, unknown>) {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) throw new Error('query is required.')
  if (query.length > 500) throw new Error('query is too long.')
  const requestedLimit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : 5
  return {
    query,
    limit: Math.min(5, Math.max(1, requestedLimit)),
    visual: input.visual === true,
  }
}

function normalizeProductSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function rankCatalogueProducts(products: CatalogProduct[], query: string): CatalogProduct[] {
  const normalizedQuery = normalizeProductSearchText(query)
  return products
    .map((product, index) => {
      const normalizedName = normalizeProductSearchText(product.name)
      let score = 0
      if (normalizedName === normalizedQuery) score += 100
      else if (normalizedName.startsWith(normalizedQuery)) score += 60
      else if (normalizedName.includes(normalizedQuery)) score += 30
      if (product.imageUrl) score += 20
      if (product.stockQuantity !== null && product.stockQuantity > 0) score += 5
      return { product, index, score }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ product }) => product)
}

function buildProductCaption(product: CatalogProduct, visualCard = false): string {
  const parts = [
    product.name,
    `${Number(product.price).toLocaleString('pt-PT', {
      maximumFractionDigits: 2,
    })} ${product.currency}`,
  ]
  if (product.stockQuantity !== null) {
    parts.push(
      product.stockQuantity > 0
        ? `Disponível: ${product.stockQuantity}`
        : 'Actualmente sem stock',
    )
  }
  if (visualCard) {
    parts.push('Responda directamente a esta fotografia se quiser este produto.')
  }
  return parts.join('\n').slice(0, 1024)
}

function buildPendingProduct(
  productRef: string,
  product: CatalogProduct,
  visualCard = false,
): PendingProductSend | null {
  if (!product.imageUrl) return null
  let imageUrl: URL
  try {
    imageUrl = new URL(product.imageUrl)
  } catch {
    return null
  }
  if (imageUrl.protocol !== 'https:') return null

  const directImageUrl = imageUrl.toString()
  const deliveryImageUrl = buildCatalogueMediaProxyUrl(directImageUrl) ?? directImageUrl
  return {
    productRef,
    name: product.name,
    imageUrl: deliveryImageUrl,
    displayImageUrl: directImageUrl,
    caption: buildProductCaption(product, visualCard),
  }
}

export function createAutoReplyTools(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  config: Pick<AiConfig, 'embeddingsApiKey'>
  permissions: Record<AgentToolKey, boolean>
}): ToolSet {
  const {
    db,
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    config,
    permissions,
  } = args
  const pendingProductSends: PendingProductSend[] = []
  const pendingProductGalleries: PendingProductGallery[] = []
  const availableProducts = new Map<string, CatalogProduct>()
  let productRefSequence = 0

  const executeTool: AgentToolExecutor = async (call) => {
    const toolKey = call.name as AgentToolKey
    if (!(toolKey in permissions) || !permissions[toolKey]) {
      throw new Error(`Tool is disabled for this agent: ${call.name}`)
    }

    const input = parseObject(call.arguments)

    if (call.name === SEARCH_KNOWLEDGE_TOOL.name) {
      const search = parseSearchInput(input)
      const matches = await retrieveKnowledge(
        db,
        accountId,
        config,
        search.query,
        search.limit,
      )
      return JSON.stringify({
        ok: true,
        query: search.query,
        matches,
        found: matches.length > 0,
      })
    }

    if (call.name === SEARCH_CATALOG_TOOL.name) {
      const search = parseSearchInput(input)
      const products = rankCatalogueProducts(
        await searchCatalogues(db, accountId, search),
        search.query,
      )
      const referencedProducts = products.map((product) => {
        productRefSequence += 1
        const productRef = `catalog_result_${productRefSequence}`
        availableProducts.set(productRef, product)
        return { ...product, product_ref: productRef }
      })

      let visualQueued = false
      if (search.visual && referencedProducts.length > 0) {
        const visualItems = referencedProducts
          .slice(0, 3)
          .map((product) =>
            buildPendingProduct(
              product.product_ref,
              product as CatalogProduct,
              true,
            ),
          )
          .filter((item): item is PendingProductSend => Boolean(item))

        if (visualItems.length > 0) {
          pendingProductGalleries.push({ items: visualItems })
          visualQueued = true
        }
      }

      return JSON.stringify({
        ok: true,
        query: search.query,
        products: referencedProducts,
        found: referencedProducts.length > 0,
        visual_queued: visualQueued,
        instruction: visualQueued
          ? 'The server queued visual WhatsApp product cards. Do not repeat these products as a numbered list and do not ask the customer to type a number. Tell them briefly that they can reply directly to the product photograph they prefer.'
          : 'Only quote prices and availability returned here. To send one photograph, call send_product with the exact product_ref. Do not use a product id or URL.',
      })
    }

    if (call.name === SEND_PRODUCT_TOOL.name) {
      const productRef =
        typeof input.product_ref === 'string' ? input.product_ref.trim() : ''
      if (!productRef) throw new Error('product_ref is required.')
      if (pendingProductSends.length >= 3) {
        throw new Error('A maximum of three products can be sent per reply.')
      }
      if (pendingProductSends.some((item) => item.productRef === productRef)) {
        return JSON.stringify({ ok: true, queued: true, duplicate: true })
      }

      const product = availableProducts.get(productRef)
      if (!product) {
        throw new Error(
          'Unknown or expired product_ref. Call search_catalog before send_product.',
        )
      }
      const pending = buildPendingProduct(productRef, product)
      if (!pending) {
        throw new Error('This product has no valid HTTPS photograph to send.')
      }
      pendingProductSends.push(pending)

      return JSON.stringify({
        ok: true,
        queued: true,
        product: { product_ref: productRef, name: product.name },
        instruction:
          'The photograph is queued and will be sent after server-side conversation checks pass. Do not repeat the full caption in the final text.',
      })
    }

    throw new Error(`Unknown or unavailable tool: ${call.name}`)
  }

  const tools = (Object.keys(TOOL_DEFINITIONS) as AgentToolKey[])
    .filter((key) => permissions[key])
    .map((key) => TOOL_DEFINITIONS[key])

  return {
    tools,
    executeTool,
    hasPendingActions: () =>
      pendingProductSends.length > 0 || pendingProductGalleries.length > 0,
    dispatchPendingActions: async () => {
      let sent = 0

      for (const gallery of pendingProductGalleries.splice(0)) {
        for (const item of gallery.items) {
          const result = await engineSendMedia({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            kind: 'image',
            link: item.imageUrl,
            caption: item.caption,
          })

          const { error: enrichError } = await db
            .from('messages')
            .update({ media_url: item.displayImageUrl, ai_generated: true })
            .eq('conversation_id', conversationId)
            .eq('message_id', result.whatsapp_message_id)
          if (enrichError) {
            console.warn(
              '[ai product gallery] media sent but inbox metadata update failed:',
              enrichError.message,
            )
          }
          sent += 1
        }
      }

      for (const item of pendingProductSends.splice(0)) {
        console.info('[ai send_product] sending product image:', {
          productRef: item.productRef,
          name: item.name,
          deliveryUrl: item.imageUrl,
          sourceUrl: item.displayImageUrl,
        })

        const result = await engineSendMedia({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          kind: 'image',
          link: item.imageUrl,
          caption: item.caption,
        })

        const { error: enrichError } = await db
          .from('messages')
          .update({ media_url: item.displayImageUrl, ai_generated: true })
          .eq('conversation_id', conversationId)
          .eq('message_id', result.whatsapp_message_id)
        if (enrichError) {
          console.warn(
            '[ai send_product] media sent but inbox metadata update failed:',
            enrichError.message,
          )
        }
        sent += 1
      }
      return sent
    },
  }
}
